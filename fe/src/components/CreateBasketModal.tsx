"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { BasketCreationFields, BasketCreationFooter } from "@/components/BasketCreationFields";
import { Dialog } from "@/components/ui/Dialog";
import "@/components/transactions.css";
import { extractCreatedBasketAddress, registerConfirmedBasket } from "@/lib/createSeed";
import { walletActionError } from "@/lib/walletErrors";
import { basketTargetAssets, basketTargetTotal, type BasketTargetMap } from "@/components/BasketAllocationEditor";

export function CreateBasketModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [targets, setTargets] = useState<BasketTargetMap>({});

  const [previewing, setPreviewing] = useState(false);
  const [transactionError, setTransactionError] = useState<string | null>(null);

  const targetChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 8453);
  const publicClient = usePublicClient({ chainId: targetChainId });
  const { isPending: isApproving, writeContractAsync } = useWriteContract();
  const [isWorking, setIsWorking] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const isPending = isApproving || isWorking;


  const handleExecute = async () => {
    if (!isConnected || !address) {
      setTransactionError("Connect your wallet before creating a basket.");
      return;
    }

    if (isPending) return;
    setIsWorking(true);
    setTransactionError(null);
    try {
      if (Object.keys(targets).length === 0 || basketTargetTotal(targets) !== 100) {
        throw new Error("Choose at least one target asset and make the allocation total 100%.");
      }
      const cleanName = name.trim() || "Custom Basket";
      const defaultChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 8453);
      const targetChainId = (publicClient?.chain?.id && (publicClient.chain.id in CONTRACT_ADDRESSES))
        ? publicClient.chain.id
        : defaultChainId;
      const config = CONTRACT_ADDRESSES[targetChainId as keyof typeof CONTRACT_ADDRESSES];
      if (!config) throw new Error(`Othelio is not configured for chain ${targetChainId}.`);
      if (!publicClient) throw new Error("Wallet client is unavailable on this network.");

      const factoryAbi = [{
        type: "function",
        name: "createBasket",
        stateMutability: "nonpayable",
        inputs: [{ name: "name", type: "string" }],
        outputs: [{ name: "basket", type: "address" }],
      }] as const;

      const estimatedGas = await publicClient.estimateContractGas({
        address: config.factory,
        abi: factoryAbi,
        functionName: "createBasket",
        args: [cleanName],
        account: address,
      }).catch(() => null);

      const gasLimit = estimatedGas ? (estimatedGas * BigInt(120)) / BigInt(100) : BigInt(1_200_000);

      const createTxHash = await writeContractAsync({
        chainId: targetChainId,
        address: config.factory,
        account: address,
        abi: factoryAbi,
        functionName: "createBasket",
        args: [cleanName],
        gas: gasLimit,
      });
      setIsConfirming(true);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: createTxHash });
      if (!receipt || receipt.status !== "success") throw new Error("Basket creation transaction failed.");

      const basketAddress = extractCreatedBasketAddress(receipt, config.factory);
      if (!basketAddress) throw new Error("The receipt did not contain the BasketCreated event.");

      await registerConfirmedBasket({
        chainId: targetChainId,
        address: basketAddress,
        controller: address,
        name: cleanName,
        symbol: symbol.trim() ? `OTH-${symbol.trim()}` : "OTH",
        createdBlock: Number(receipt.blockNumber),
        createdBlockHash: receipt.blockHash,
        createdTx: receipt.transactionHash,
        assets: basketTargetAssets(targets),
      });
      router.push(`/app/baskets/${basketAddress}`);
    } catch (error) {
      setTransactionError(walletActionError(error, "Unable to create the basket."));
    } finally {
      setIsWorking(false);
      setIsConfirming(false);
    }
  };

  const fields = <BasketCreationFields name={name} symbol={symbol} targets={targets} onName={setName} onSymbol={setSymbol} onTargets={setTargets} reviewing={previewing} />;
  const footer = <BasketCreationFooter targets={targets} reviewing={previewing} busy={isPending} confirming={isConfirming} connected={isConnected} error={transactionError} onBack={previewing ? () => setPreviewing(false) : onClose} onContinue={previewing ? handleExecute : () => setPreviewing(true)} />;
  return (
    <Dialog open={isOpen} onClose={onClose} title={previewing ? "Review basket" : "Create basket"} description="Choose your assets and allocation. Fund your basket after creation." kind="sheet" size="wide" footer={footer}>{fields}</Dialog>
  );
}
