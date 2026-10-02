"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { extractCreatedBasketAddress, registerConfirmedBasket } from "@/lib/createSeed";
import { WALLET_REQUEST_REJECTED_MESSAGE, walletActionError } from "@/lib/walletErrors";
import { useHydrated } from "@/hooks/useHydrated";

export default function CreateBasketPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const isHydrated = useHydrated();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");

  const [transactionError, setTransactionError] = useState<string | null>(null);

  const targetChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 8453);
  const publicClient = usePublicClient({ chainId: targetChainId });
  const { isPending: isApproving, writeContractAsync } = useWriteContract();
  const isPending = isApproving;
  const hasConnectedWallet = isHydrated && isConnected && Boolean(address);

  const handleExecute = async () => {
    if (!hasConnectedWallet || !address) {
      setTransactionError("Connect your wallet before creating a basket.");
      return;
    }

    setTransactionError(null);
    try {
      const cleanName = name.trim() || "Custom Basket";
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
      if (receipt.status !== "success") {
        throw new Error("Basket creation transaction failed.");
      }
      const basketAddress = extractCreatedBasketAddress(receipt, config.factory);
      if (!basketAddress) {
        throw new Error("The receipt did not contain the BasketCreated event.");
      }
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
    <div className="app-page-frame">
      {/* Top Navigation Breadcrumbs */}
      <div style={{ marginBottom: "24px" }}>
        <Link
          href="/app/baskets"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "13px",
            color: "var(--muted-ink)",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          ← Back to Baskets
        </Link>
      </div>

      <header style={{ marginBottom: "32px" }}>
        <h1 className="page-title">
          Create New Basket
        </h1>
        <p className="page-description">
          Create the basket now. Its initial target allocation will be measured from the first onchain funding transaction.
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "32px", alignItems: "start" }}>
        {/* Main Creation Form Area */}
        <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
          {/* Section 1: Basket identity */}
          <div
            style={{
              padding: "24px",
              background: "var(--panel)",
              borderRadius: "16px",
              border: "1px solid var(--line)",
            }}
          >
            <h3 style={{ fontSize: "15px", fontWeight: 700, marginBottom: "16px" }}>1. Basket identity</h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: "14px" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted-ink)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Basket Name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Momentum Tech Core"
                    style={{
                      padding: "11px 14px",
                      background: "var(--panel-2)",
                      border: "1px solid var(--panel-border)",
                      borderRadius: "10px",
                      color: "var(--ink)",
                      fontSize: "14px",
                      outline: "none",
                    }}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted-ink)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Symbol</span>
                  <input
                    type="text"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                    placeholder="MCORE"
                    style={{
                      padding: "11px 14px",
                      background: "var(--panel-2)",
                      border: "1px solid var(--panel-border)",
                      borderRadius: "10px",
                      color: "var(--ink)",
                      fontSize: "14px",
                      outline: "none",
                      fontWeight: 700,
                    }}
                  />
                </label>
              </div>

            </div>
          </div>

          <div style={{ padding: "24px", background: "var(--panel)", borderRadius: "16px", border: "1px solid var(--line)" }}>
            <h3 style={{ fontSize: "15px", fontWeight: 700, marginBottom: "8px" }}>Allocation after funding</h3>
            <p style={{ margin: 0, color: "var(--muted-ink)", fontSize: "13px" }}>
              This basket starts without an allocation. Add funds after creation; the indexed onchain balances and prices will set its initial target.
            </p>
          </div>
        </div>

        {/* Sticky Right Column Summary Card */}
        <div style={{ position: "sticky", top: "32px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              padding: "24px",
              background: "var(--panel)",
              borderRadius: "16px",
              border: "1px solid var(--line)",
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "16px" }}>Basket Summary</h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px", borderBottom: "1px solid var(--line)", paddingBottom: "16px", marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted-ink)" }}>Name</span>
                <strong>{name || "—"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted-ink)" }}>Symbol</span>
                <strong>{symbol || "—"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted-ink)" }}>Funding</span>
                <strong>Add USDC after creation</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted-ink)" }}>Target allocation</span>
                <strong>Available after funding</strong>
              </div>
            </div>

            <button
              className="primary"
              disabled={!hasConnectedWallet || isPending}
              onClick={handleExecute}
              style={{
                width: "100%",
                padding: "14px",
                fontSize: "14px",
                fontWeight: 700,
                borderRadius: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
            >
              {isPending ? "Waiting Wallet..." : !hasConnectedWallet ? "Connect wallet first" : "Create basket"}
              <AppIcon type="arrow" />
            </button>

            {transactionError && (
              <div
                role={transactionError === WALLET_REQUEST_REJECTED_MESSAGE ? "status" : "alert"}
                style={{ color: transactionError === WALLET_REQUEST_REJECTED_MESSAGE ? "var(--muted-ink)" : "#ef4444", fontSize: "12px", marginTop: "12px", textAlign: "center" }}
              >
                <strong style={{ display: "block", marginBottom: "3px" }}>
                  {transactionError === WALLET_REQUEST_REJECTED_MESSAGE ? "Transaction cancelled" : "Could not create basket"}
                </strong>
                <span>{transactionError}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
