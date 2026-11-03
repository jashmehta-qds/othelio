"use client";

import React, { useState, useEffect } from "react";
import { useAccount, useChainId, useSignTypedData, useReadContract, useWriteContract } from "wagmi";
import {
  BASE_CHAIN_ID,
  BASE_USDC_ADDRESS,
  LIMIT_ORDER_EIP712_TYPES,
  ZERO_EX_EIP712_DOMAIN,
  ZERO_EX_EXCHANGE_PROXY_BASE,
  ZERO_EX_LIMIT_ORDER_ABI,
  ZeroExLimitOrder,
  ZeroExSignature,
} from "@othelio/shared";
import { parseUnits, formatUnits, getAddress, parseAbi, maxUint256 } from "viem";

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

interface OrderTicketProps {
  seriesAddress: string;
  claimType: "protected" | "upside";
  claimTokenAddress: string;
  symbol: string;
  seriesExpiryTimestamp: number;
  initialPrice?: string;
  initialSide?: "BUY" | "SELL";
  initialOrderHash?: string;
  onOrderCreated?: () => void;
}

export function OrderTicket({
  seriesAddress,
  claimType,
  claimTokenAddress,
  symbol,
  seriesExpiryTimestamp,
  initialPrice = "",
  initialSide = "BUY",
  initialOrderHash,
  onOrderCreated,
}: OrderTicketProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signTypedDataAsync, isPending: isSigning } = useSignTypedData();
  const { writeContractAsync, isPending: isTxPending } = useWriteContract();

  const [orderMode, setOrderMode] = useState<"LIMIT" | "FILL">("LIMIT");
  const [side, setSide] = useState<"BUY" | "SELL">(initialSide);
  const [priceUsd, setPriceUsd] = useState<string>(initialPrice);
  const [selectedOrderHash, setSelectedOrderHash] = useState<string | undefined>(initialOrderHash);
  const [amountClaims, setAmountClaims] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialPrice) setPriceUsd(initialPrice);
  }, [initialPrice]);

  useEffect(() => {
    if (initialSide) setSide(initialSide);
  }, [initialSide]);

  useEffect(() => {
    if (initialOrderHash) {
      setSelectedOrderHash(initialOrderHash);
      setOrderMode("FILL");
    }
  }, [initialOrderHash]);

  // Determine token that user must spend
  // BUY: user spends USDC (6 dec)
  // SELL: user spends Claims (8 dec)
  const isBuy = side === "BUY";
  const userToken = isBuy ? BASE_USDC_ADDRESS : claimTokenAddress;
  const userDecimals = isBuy ? 6 : 8;

  // Read balance and allowance for 0x ExchangeProxy
  const { data: balanceData, refetch: refetchBalance } = useReadContract({
    address: userToken as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && userToken) },
  });

  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    address: userToken as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, ZERO_EX_EXCHANGE_PROXY_BASE] : undefined,
    query: { enabled: Boolean(address && userToken) },
  });

  const userBalance = balanceData ? formatUnits(balanceData, userDecimals) : "0";
  const userAllowance = allowanceData ?? BigInt(0);

  // Calculations
  const claimAmtNum = parseFloat(amountClaims || "0");
  const priceNum = parseFloat(priceUsd || "0");
  const totalUsdcNum = claimAmtNum * priceNum;

  const requiredUnits = isBuy
    ? parseUnits(totalUsdcNum.toFixed(6), 6)
    : parseUnits(claimAmtNum.toFixed(8), 8);

  const needsApproval = isConnected && userAllowance < requiredUnits && requiredUnits > BigInt(0);

  const handleApprove = async () => {
    setErrorMessage(null);
    try {
      const maxApproval = maxUint256;
      await writeContractAsync({
        address: userToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [ZERO_EX_EXCHANGE_PROXY_BASE, maxApproval],
      });
      setStatusMessage("Approval submitted. Updating allowance...");
      setTimeout(() => {
        refetchAllowance();
        setStatusMessage(null);
      }, 3000);
    } catch (err: any) {
      setErrorMessage(err?.message || "Token approval failed");
    }
  };

  const handlePlaceLimitOrder = async () => {
    if (!address || !isConnected) {
      setErrorMessage("Please connect your wallet first.");
      return;
    }

    if (claimAmtNum <= 0 || priceNum <= 0) {
      setErrorMessage("Please enter a valid price and claim amount.");
      return;
    }

    setErrorMessage(null);
    setStatusMessage("Preparing signed limit order...");

    try {
      const takerAmountUnits = isBuy
        ? parseUnits(claimAmtNum.toFixed(8), 8)
        : parseUnits(totalUsdcNum.toFixed(6), 6);

      const orderExpiry = Math.min(
        Math.floor(Date.now() / 1000) + 7 * 86400, // 7 days or series expiry
        seriesExpiryTimestamp
      );

      const salt = BigInt(Math.floor(Date.now() * 1000 + Math.random() * 1000)).toString();

      const order: ZeroExLimitOrder = {
        makerToken: (isBuy ? BASE_USDC_ADDRESS : claimTokenAddress) as `0x${string}`,
        takerToken: (isBuy ? claimTokenAddress : BASE_USDC_ADDRESS) as `0x${string}`,
        makerAmount: requiredUnits.toString(),
        takerAmount: takerAmountUnits.toString(),
        takerTokenFeeAmount: "0",
        maker: address,
        taker: "0x0000000000000000000000000000000000000000",
        sender: "0x0000000000000000000000000000000000000000",
        feeRecipient: "0x0000000000000000000000000000000000000000",
        pool: "0x0000000000000000000000000000000000000000000000000000000000000000",
        expiry: orderExpiry,
        salt,
      };

      const domain = {
        ...ZERO_EX_EIP712_DOMAIN,
        chainId,
        verifyingContract: ZERO_EX_EXCHANGE_PROXY_BASE,
      };

      const rawSig = await signTypedDataAsync({
        domain,
        types: LIMIT_ORDER_EIP712_TYPES,
        primaryType: "LimitOrder",
        message: {
          makerToken: getAddress(order.makerToken),
          takerToken: getAddress(order.takerToken),
          makerAmount: BigInt(order.makerAmount),
          takerAmount: BigInt(order.takerAmount),
          takerTokenFeeAmount: BigInt(0),
          maker: getAddress(order.maker),
          taker: getAddress(order.taker),
          sender: getAddress(order.sender),
          feeRecipient: getAddress(order.feeRecipient),
          pool: order.pool as `0x${string}`,
          expiry: BigInt(order.expiry),
          salt: BigInt(order.salt),
        },
      });

      const signature: ZeroExSignature = {
        signatureType: 2,
        v: parseInt(rawSig.slice(130, 132), 16),
        r: rawSig.slice(0, 66) as `0x${string}`,
        s: ("0x" + rawSig.slice(66, 130)) as `0x${string}`,
      };

      setStatusMessage("Broadcasting order to Othelio book...");

      const res = await fetch(`${API_BASE}/v1/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order,
          signature,
          chainId,
          seriesAddress,
          claimType: claimType.toUpperCase(),
        }),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(errorJson.message || "Failed to post order to book");
      }

      setStatusMessage("Order posted successfully!");
      setAmountClaims("");
      setTimeout(() => setStatusMessage(null), 3000);
      onOrderCreated?.();
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to sign or submit order");
      setStatusMessage(null);
    }
  };

  const handleFillOrder = async () => {
    if (!address || !isConnected) {
      setErrorMessage("Please connect your wallet first.");
      return;
    }
    if (!selectedOrderHash) {
      setErrorMessage("No resting order selected. Click an order in the book to fill it.");
      return;
    }
    if (claimAmtNum <= 0) {
      setErrorMessage("Please enter a valid claim amount to fill.");
      return;
    }

    setErrorMessage(null);
    setStatusMessage("Preparing onchain fill transaction...");

    try {
      // 0x takerTokenFillAmount:
      // If BUYing claims: taker pays USDC -> takerTokenFillAmount is total USDC (6 decimals)
      // If SELLing claims: taker pays Claim -> takerTokenFillAmount is Claims (8 decimals)
      const takerFillUnits = isBuy
        ? parseUnits(totalUsdcNum.toFixed(6), 6)
        : parseUnits(claimAmtNum.toFixed(8), 8);

      const buildRes = await fetch(
        `${API_BASE}/v1/orders/${selectedOrderHash}/build-fill?chainId=${chainId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            takerAddress: address,
            takerTokenFillAmount: takerFillUnits.toString(),
          }),
        }
      );

      if (!buildRes.ok) {
        const errJson = await buildRes.json().catch(() => ({}));
        throw new Error(errJson.message || "Failed to build fill transaction");
      }

      const fillData = await buildRes.json();

      setStatusMessage("Confirming fill transaction in wallet...");

      const txHash = await writeContractAsync({
        address: fillData.target as `0x${string}`,
        abi: ZERO_EX_LIMIT_ORDER_ABI,
        functionName: "fillLimitOrder",
        args: fillData.args,
      });

      setStatusMessage(`Fill submitted onchain: ${txHash.slice(0, 10)}…`);
      setAmountClaims("");
      setTimeout(() => {
        setStatusMessage(null);
        refetchBalance();
        refetchAllowance();
        onOrderCreated?.();
      }, 4000);
    } catch (err: any) {
      setErrorMessage(err?.message || "Fill execution failed");
      setStatusMessage(null);
    }
  };

  return (
    <div className="bg-[#161715] border border-[#292a27] rounded-lg p-5 space-y-4 text-xs font-mono">
      {/* Mode & Side Selectors */}
      <div className="flex flex-col gap-3 pb-3 border-b border-[#292a27]">
        <div className="flex justify-between items-center">
          <div className="flex space-x-1 bg-[#10110f] p-1 rounded border border-[#292a27]">
            <button
              type="button"
              onClick={() => setOrderMode("LIMIT")}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                orderMode === "LIMIT"
                  ? "bg-[#292a27] text-white font-semibold"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Limit Order
            </button>
            <button
              type="button"
              onClick={() => setOrderMode("FILL")}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                orderMode === "FILL"
                  ? "bg-[#292a27] text-white font-semibold"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Fill Resting
            </button>
          </div>

          <div className="flex space-x-1">
            <button
              type="button"
              onClick={() => setSide("BUY")}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                side === "BUY"
                  ? "bg-emerald-600 text-black font-semibold"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Buy
            </button>
            <button
              type="button"
              onClick={() => setSide("SELL")}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                side === "SELL"
                  ? "bg-red-600 text-white font-semibold"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Sell
            </button>
          </div>
        </div>

        {orderMode === "FILL" && (
          <div className="p-2 bg-[#121310] border border-[#292a27] rounded text-[11px] text-zinc-400 flex justify-between items-center">
            <span>
              {selectedOrderHash
                ? `Order: ${selectedOrderHash.slice(0, 8)}…${selectedOrderHash.slice(-6)}`
                : "Click any book order to target"}
            </span>
            {selectedOrderHash && (
              <button
                type="button"
                onClick={() => setSelectedOrderHash(undefined)}
                className="text-zinc-500 hover:text-zinc-300 ml-2"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Balance helper */}
      <div className="flex justify-between text-zinc-500 text-[11px]">
        <span>Available:</span>
        <span className="text-zinc-300">
          {userBalance} {isBuy ? "USDC" : `${symbol} Claims`}
        </span>
      </div>

      {/* Price input */}
      <div className="space-y-1">
        <label className="text-zinc-400 uppercase tracking-wider block text-[11px]">
          {orderMode === "FILL" ? "Execution Price (USDC)" : "Limit Price (USDC per claim)"}
        </label>
        <input
          type="number"
          placeholder="0.00"
          value={priceUsd}
          onChange={(e) => setPriceUsd(e.target.value)}
          readOnly={orderMode === "FILL" && Boolean(selectedOrderHash)}
          step="0.01"
          className="w-full bg-[#10110f] border border-[#292a27] rounded px-3 py-2 text-white focus:outline-none focus:border-[#ff5729] read-only:opacity-80"
        />
      </div>

      {/* Amount input */}
      <div className="space-y-1">
        <div className="flex justify-between items-center text-[11px]">
          <label className="text-zinc-400 uppercase tracking-wider">
            Claim Amount
          </label>
          <button
            type="button"
            onClick={() => {
              if (!isBuy) {
                setAmountClaims(userBalance);
              } else if (priceNum > 0) {
                const maxClaims = parseFloat(userBalance) / priceNum;
                setAmountClaims(maxClaims.toFixed(4));
              }
            }}
            className="text-[#ff5729] hover:underline"
          >
            Max
          </button>
        </div>
        <input
          type="number"
          placeholder="0.0000"
          value={amountClaims}
          onChange={(e) => setAmountClaims(e.target.value)}
          step="0.0001"
          className="w-full bg-[#10110f] border border-[#292a27] rounded px-3 py-2 text-white focus:outline-none focus:border-[#ff5729]"
        />
      </div>

      {/* Total calculation */}
      <div className="p-3 bg-[#10110f] border border-[#292a27] rounded flex justify-between items-center">
        <span className="text-zinc-500">Total (USDC):</span>
        <span className="font-semibold text-white">${totalUsdcNum.toFixed(2)}</span>
      </div>

      {/* Status & Error Messages */}
      {statusMessage && (
        <div className="p-2 bg-emerald-950/40 border border-emerald-900 rounded text-emerald-400 text-[11px]">
          {statusMessage}
        </div>
      )}

      {errorMessage && (
        <div className="p-2 bg-red-950/40 border border-red-900 rounded text-red-400 text-[11px]">
          {errorMessage}
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-2 pt-2">
        {needsApproval ? (
          <button
            type="button"
            onClick={handleApprove}
            disabled={isTxPending}
            className="w-full py-2.5 rounded bg-[#292a27] hover:bg-[#3f413c] text-white font-semibold tracking-wider uppercase transition-colors disabled:opacity-50"
          >
            {isTxPending ? "Approving in Wallet..." : `Approve ${isBuy ? "USDC" : "Claim"} for Trading`}
          </button>
        ) : orderMode === "FILL" ? (
          <button
            type="button"
            onClick={handleFillOrder}
            disabled={isTxPending || !isConnected || claimAmtNum <= 0 || !selectedOrderHash}
            className={`w-full py-2.5 rounded font-semibold tracking-wider uppercase transition-colors disabled:opacity-50 ${
              side === "BUY"
                ? "bg-emerald-600 hover:bg-emerald-500 text-black"
                : "bg-red-600 hover:bg-red-500 text-white"
            }`}
          >
            {isTxPending
              ? "Executing Fill..."
              : !selectedOrderHash
              ? "Select an Order in Book"
              : `Fill ${side} Order onchain`}
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePlaceLimitOrder}
            disabled={isSigning || !isConnected || claimAmtNum <= 0}
            className={`w-full py-2.5 rounded font-semibold tracking-wider uppercase transition-colors disabled:opacity-50 ${
              side === "BUY"
                ? "bg-emerald-600 hover:bg-emerald-500 text-black"
                : "bg-red-600 hover:bg-red-500 text-white"
            }`}
          >
            {isSigning ? "Signing Order in Wallet..." : `Sign Limit ${side} Order`}
          </button>
        )}
      </div>

      <p className="text-[10px] text-zinc-500 text-center">
        Zero custody: resting orders stay in your wallet until executed onchain via 0x ExchangeProxy.
      </p>
    </div>
  );
}
