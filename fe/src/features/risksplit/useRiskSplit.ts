"use client";

import { useAccount, useChainId, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { formatUnits, parseUnits } from "viem";
import { RISK_SPLIT_SERIES_ABI, SETTLEMENT_ADAPTER_ABI } from "@/lib/contracts";
import { fetchApi } from "@/lib/api";

export interface RiskSplitSeriesData {
  chainId: number;
  seriesAddress: string;
  underlyingAddress: string;
  protectedTokenAddress: string;
  upsideTokenAddress: string;
  settlementAdapterAddress: string;
  floorPrice: string;
  capPrice: string;
  expiryTimestamp: number;
  isSettled: boolean;
  settledPrice: string | null;
  protectedFraction: string | null;
  upsideFraction: string | null;
  creationReferencePriceUsdE8?: string | null;
  creationFeedAddress?: string | null;
  creationFeedRoundId?: string | null;
  creationFeedUpdatedAt?: string | null;
  creationReferenceBlock?: number | null;
  creationReferenceVerified?: boolean;
}

const ERC20_ABI = [
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

export function useRiskSplit(selectedAddress?: string) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });

  // 1. Fetch Series List from Backend API
  const { data: seriesList = [], isLoading: isLoadingList, isError: isErrorList, refetch: refetchList } = useQuery<RiskSplitSeriesData[]>({
    queryKey: ["risk-split-series", chainId],
    queryFn: () => fetchApi(`/v1/risksplit/series?chainId=${chainId}`),
  });

  const activeSeries = selectedAddress
    ? seriesList.find((s) => s.seriesAddress.toLowerCase() === selectedAddress.toLowerCase())
    : seriesList[0];

  const seriesAddress = (activeSeries?.seriesAddress || "0x0000000000000000000000000000000000000000") as `0x${string}`;
  const underlyingAddress = (activeSeries?.underlyingAddress || "0x0000000000000000000000000000000000000000") as `0x${string}`;
  const protectedTokenAddress = (activeSeries?.protectedTokenAddress || "0x0000000000000000000000000000000000000000") as `0x${string}`;
  const upsideTokenAddress = (activeSeries?.upsideTokenAddress || "0x0000000000000000000000000000000000000000") as `0x${string}`;
  const adapterAddress = (activeSeries?.settlementAdapterAddress || "0x0000000000000000000000000000000000000000") as `0x${string}`;

  const { data: underlyingDecimalsRaw } = useReadContract({ address: underlyingAddress, abi: ERC20_ABI, functionName: "decimals", chainId, query: { enabled: Boolean(activeSeries) } });
  const { data: protectedDecimalsRaw } = useReadContract({ address: protectedTokenAddress, abi: ERC20_ABI, functionName: "decimals", chainId, query: { enabled: Boolean(activeSeries) } });
  const { data: upsideDecimalsRaw } = useReadContract({ address: upsideTokenAddress, abi: ERC20_ABI, functionName: "decimals", chainId, query: { enabled: Boolean(activeSeries) } });
  const underlyingDecimals = underlyingDecimalsRaw == null ? null : Number(underlyingDecimalsRaw);
  const protectedDecimals = protectedDecimalsRaw == null ? null : Number(protectedDecimalsRaw);
  const upsideDecimals = upsideDecimalsRaw == null ? null : Number(upsideDecimalsRaw);
  const unitsCompatible = underlyingDecimals !== null && underlyingDecimals === protectedDecimals && underlyingDecimals === upsideDecimals;

  // 2. Onchain Balances
  const { data: underlyingBal, refetch: refetchUnderlyingBal } = useReadContract({
    address: underlyingAddress,
    chainId,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && underlyingAddress !== "0x0000000000000000000000000000000000000000" },
  });

  const { data: underlyingAllowance, refetch: refetchUnderlyingAllowance } = useReadContract({
    address: underlyingAddress,
    chainId,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && seriesAddress ? [address, seriesAddress] : undefined,
    query: { enabled: !!address && seriesAddress !== "0x0000000000000000000000000000000000000000" },
  });

  const { data: protectedBal, refetch: refetchProtectedBal } = useReadContract({
    address: protectedTokenAddress,
    chainId,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && protectedTokenAddress !== "0x0000000000000000000000000000000000000000" },
  });

  const { data: upsideBal, refetch: refetchUpsideBal } = useReadContract({
    address: upsideTokenAddress,
    chainId,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && upsideTokenAddress !== "0x0000000000000000000000000000000000000000" },
  });

  // 3. Series Onchain Status
  const { data: onchainIsSettled } = useReadContract({
    address: seriesAddress,
    chainId,
    abi: RISK_SPLIT_SERIES_ABI,
    functionName: "isSettled",
    query: { enabled: seriesAddress !== "0x0000000000000000000000000000000000000000" },
  });

  const { data: onchainProtectedFraction } = useReadContract({
    address: seriesAddress,
    chainId,
    abi: RISK_SPLIT_SERIES_ABI,
    functionName: "protectedFraction",
    query: { enabled: !!onchainIsSettled },
  });

  const { data: onchainUpsideFraction } = useReadContract({
    address: seriesAddress,
    chainId,
    abi: RISK_SPLIT_SERIES_ABI,
    functionName: "upsideFraction",
    query: { enabled: !!onchainIsSettled },
  });

  // 4. Contract Writes
  const { writeContractAsync, isPending } = useWriteContract();

  const confirm = async (hash: `0x${string}`) => {
    if (!publicClient) throw new Error("Base RPC is unavailable; transaction confirmation could not be checked.");
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Transaction reverted onchain.");
    await Promise.allSettled([refetchUnderlyingBal(), refetchUnderlyingAllowance(), refetchProtectedBal(), refetchUpsideBal()]);
    return receipt;
  };

  const approveUnderlying = async (amount: string) => {
    if (!unitsCompatible) throw new Error("Token units are not verified for this series.");
    const raw = parseUnits(amount, underlyingDecimals!);
    const hash = await writeContractAsync({
      address: underlyingAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [seriesAddress, raw],
    });
    return confirm(hash);
  };

  const mint = async (amount: string) => {
    if (!unitsCompatible) throw new Error("Token units are not verified for this series.");
    const raw = parseUnits(amount, underlyingDecimals!);
    const hash = await writeContractAsync({
      address: seriesAddress,
      abi: RISK_SPLIT_SERIES_ABI,
      functionName: "mint",
      args: [raw],
    });
    return confirm(hash);
  };

  const combineAndRedeem = async (amount: string) => {
    if (!unitsCompatible) throw new Error("Token units are not verified for this series.");
    const raw = parseUnits(amount, underlyingDecimals!);
    const hash = await writeContractAsync({
      address: seriesAddress,
      abi: RISK_SPLIT_SERIES_ABI,
      functionName: "combineAndRedeem",
      args: [raw],
    });
    return confirm(hash);
  };

  const redeemProtected = async (amount: string) => {
    if (!unitsCompatible) throw new Error("Token units are not verified for this series.");
    const raw = parseUnits(amount, underlyingDecimals!);
    const hash = await writeContractAsync({
      address: seriesAddress,
      abi: RISK_SPLIT_SERIES_ABI,
      functionName: "redeemProtected",
      args: [raw],
    });
    return confirm(hash);
  };

  const redeemUpside = async (amount: string) => {
    if (!unitsCompatible) throw new Error("Token units are not verified for this series.");
    const raw = parseUnits(amount, underlyingDecimals!);
    const hash = await writeContractAsync({
      address: seriesAddress,
      abi: RISK_SPLIT_SERIES_ABI,
      functionName: "redeemUpside",
      args: [raw],
    });
    return confirm(hash);
  };

  const settleSeries = async () => {
    const hash = await writeContractAsync({
      address: adapterAddress,
      abi: SETTLEMENT_ADAPTER_ABI,
      functionName: "settleSeries",
      args: [seriesAddress],
    });
    return confirm(hash);
  };

  return {
    seriesList,
    activeSeries,
    isLoadingList,
    isErrorList,
    refetchList,
    underlyingDecimals,
    unitsCompatible,
    balances: {
      underlying: underlyingDecimals !== null && underlyingBal != null ? formatUnits(underlyingBal, underlyingDecimals) : "—",
      protected: protectedDecimals !== null && protectedBal != null ? formatUnits(protectedBal, protectedDecimals) : "—",
      upside: upsideDecimals !== null && upsideBal != null ? formatUnits(upsideBal, upsideDecimals) : "—",
      allowance: underlyingDecimals !== null && underlyingAllowance != null ? formatUnits(underlyingAllowance, underlyingDecimals) : "—",
    },
    onchainState: {
      isSettled: onchainIsSettled ?? activeSeries?.isSettled ?? false,
      protectedFraction: onchainProtectedFraction ? formatUnits(onchainProtectedFraction, 18) : activeSeries?.protectedFraction,
      upsideFraction: onchainUpsideFraction ? formatUnits(onchainUpsideFraction, 18) : activeSeries?.upsideFraction,
    },
    isPending,
    actions: {
      approveUnderlying,
      mint,
      combineAndRedeem,
      redeemProtected,
      redeemUpside,
      settleSeries,
    },
  };
}
