"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { extractCreatedBasketAddress, registerConfirmedBasket } from "@/lib/createSeed";
import { walletActionError } from "@/lib/walletErrors";

export function CreateBasketModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");

  const [previewing, setPreviewing] = useState(false);
  const [transactionError, setTransactionError] = useState<string | null>(null);

  const targetChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 8453);
  const publicClient = usePublicClient({ chainId: targetChainId });
  const { isPending: isApproving, writeContractAsync } = useWriteContract();
  const isPending = isApproving;
  const isConfirming = false;

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleExecute = async () => {
    if (!isConnected || !address) {
      alert("Please connect your Web3 wallet first.");
      return;
    }

    setTransactionError(null);
    try {
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
      });
      router.push(`/app/baskets/${basketAddress}`);
    } catch (error) {
      setTransactionError(walletActionError(error, "Unable to create the basket."));
    }
  };

  return (
    <>
      <button className="drawer-backdrop" onClick={onClose} aria-label="Close basket creation" />
      <aside className="rebalance-drawer rebalance-editor" aria-label="Create basket drawer">
        <div className="drawer-scroll" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
          <header>
            <div>
              <h2>{previewing ? "Staged Basket" : "Create Basket"}</h2>
              <span>{previewing ? "Review basket details before signing" : "Create an unfunded basket"}</span>
            </div>
            <button onClick={onClose} aria-label="Close create drawer">×</button>
          </header>

          {previewing ? (
            <>
              <div className="safety-note">
                <span className="shield">✓</span>
                <p>
                  <strong>Nothing has moved yet</strong>
                  <small>This preview is side-effect-free. Your wallet signs only after final review.</small>
                </p>
              </div>

              <div className="quote-summary" style={{ marginTop: "16px" }}>
                <div>
                  <span>Basket Name</span>
                  <strong>{name}</strong>
                </div>
                <div>
                  <span>Ticker Symbol</span>
                  <strong>{symbol}</strong>
                </div>
                <div>
                  <span>Target allocation</span>
                  <strong>Measured after first funding</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{isConfirming ? "Confirming..." : isPending ? "Waiting wallet..." : "Ready"}</strong>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="drawer-intro">
                Create the basket first. Its initial target will come from indexed onchain balances and prices after funding.
              </p>

              {/* 1. Basket Details Row */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: "10px" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted-ink)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Basket Name</span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Momentum Tech Core"
                      style={{
                        padding: "9px 12px",
                        background: "var(--panel-2)",
                        border: "1px solid var(--panel-border)",
                        borderRadius: "10px",
                        color: "var(--ink)",
                        fontSize: "13px",
                        outline: "none",
                      }}
                    />
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted-ink)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Symbol</span>
                    <input
                      type="text"
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                      placeholder="MCORE"
                      style={{
                        padding: "9px 12px",
                        background: "var(--panel-2)",
                        border: "1px solid var(--panel-border)",
                        borderRadius: "10px",
                        color: "var(--ink)",
                        fontSize: "13px",
                        outline: "none",
                        fontWeight: 700,
                      }}
                    />
                  </label>
                </div>

                <small style={{ fontSize: "10px", color: "var(--muted-ink)" }}>Create the basket first. You can add USDC with a fresh quoted trade afterward.</small>
              </div>

            </>
          )}

          
        </div>

        <footer style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {transactionError && (
            <p role="status" style={{ margin: 0, color: "var(--muted-ink)", fontSize: "12px", textAlign: "center" }}>
              {transactionError}
            </p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "9px" }}>
            <button onClick={previewing ? () => setPreviewing(false) : onClose}>
              {previewing ? "Edit details" : "Cancel"}
            </button>
            <button
              className="primary"
              disabled={isPending || isConfirming}
              onClick={previewing ? handleExecute : () => setPreviewing(true)}
            >
              {previewing
                ? isConfirming
                  ? "Confirming..."
                  : isPending
                  ? "Waiting..."
                  : "Submit Transaction"
                : "Review basket"}
              <AppIcon type="arrow" />
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}
