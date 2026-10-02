"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import StockLogo from "@/components/StockLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { supportedAssets } from "@/lib/baskets";
import { extractCreatedBasketAddress, registerConfirmedBasket } from "@/lib/createSeed";
import { WALLET_REQUEST_REJECTED_MESSAGE, walletActionError } from "@/lib/walletErrors";
import { useSupportedAssets } from "@/hooks/useBaskets";
import { useHydrated } from "@/hooks/useHydrated";

export default function CreateBasketPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const isHydrated = useHydrated();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");

  // Search & add tokens
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Default start with 0 stocks or initial preset
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [transactionError, setTransactionError] = useState<string | null>(null);

  const { data: remoteAssets } = useSupportedAssets();

  const allSupportedAssets = useMemo(() => {
    if (remoteAssets?.data && remoteAssets.data.length > 0) {
      return remoteAssets.data.map((item) => ({
        symbol: item.symbol,
        name: item.name,
        target: 0,
        current: 0,
        quantity: 0,
        value: 0,
        color: item.color,
        address: item.address,
      }));
    }
    return supportedAssets;
  }, [remoteAssets]);

  const selectedSymbols = Object.keys(targets);
  const total = useMemo(() => Object.values(targets).reduce((sum, value) => sum + value, 0), [targets]);

  const selectedAssets = selectedSymbols
    .map((s) => allSupportedAssets.find((asset) => asset.symbol === s))
    .filter((asset): asset is (typeof allSupportedAssets)[number] => Boolean(asset));

  const availableAssets = useMemo(() => {
    return allSupportedAssets.filter((asset) => {
      const isNotSelected = !(asset.symbol in targets);
      const matchesSearch =
        asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        asset.name.toLowerCase().includes(searchQuery.toLowerCase());
      return isNotSelected && matchesSearch;
    });
  }, [searchQuery, targets, allSupportedAssets]);

  const targetChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 8453);
  const publicClient = usePublicClient({ chainId: targetChainId });
  const { isPending: isApproving, writeContractAsync } = useWriteContract();
  const isPending = isApproving;
  const hasConnectedWallet = isHydrated && isConnected && Boolean(address);

  const addToken = (tokenSymbol: string) => {
    setTargets((current) => {
      const next = { ...current, [tokenSymbol]: 0 };
      const keys = Object.keys(next);
      const equalShare = Math.floor(100 / keys.length);
      const remainder = 100 - equalShare * keys.length;
      keys.forEach((k, idx) => {
        next[k] = equalShare + (idx === 0 ? remainder : 0);
      });
      return next;
    });
    setSearchQuery("");
    setIsDropdownOpen(false);
  };

  const removeToken = (tokenSymbol: string) => {
    setTargets((current) => {
      const next = { ...current };
      delete next[tokenSymbol];
      const keys = Object.keys(next);
      if (keys.length === 0) return {};
      const equalShare = Math.floor(100 / keys.length);
      const remainder = 100 - equalShare * keys.length;
      keys.forEach((k, idx) => {
        next[k] = equalShare + (idx === 0 ? remainder : 0);
      });
      return next;
    });
  };

  const equalizeWeights = () => {
    const keys = Object.keys(targets);
    if (keys.length === 0) return;
    const equalShare = Math.floor(100 / keys.length);
    const remainder = 100 - equalShare * keys.length;
    const next: Record<string, number> = {};
    keys.forEach((k, idx) => {
      next[k] = equalShare + (idx === 0 ? remainder : 0);
    });
    setTargets(next);
  };

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

      const gasLimit = estimatedGas ? (estimatedGas * 120n) / 100n : 1_200_000n;

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
        assets: selectedAssets.map((asset) => ({ address: asset.address as string, targetWeightBps: (targets[asset.symbol] ?? 0) * 100 })),
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
          Define basket identity and target asset weights on-chain.
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

          {/* Section 2: Basket Composition */}
          <div
            style={{
              padding: "24px",
              background: "var(--panel)",
              borderRadius: "16px",
              border: "1px solid var(--line)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <h3 style={{ fontSize: "15px", fontWeight: 700 }}>2. Basket Composition</h3>
                <span style={{ fontSize: "12px", color: "var(--muted-ink)" }}>Select tokenized stocks to include in index</span>
              </div>
              {selectedSymbols.length > 1 && (
                <button
                  type="button"
                  onClick={equalizeWeights}
                  style={{
                    background: "var(--accent-soft)",
                    border: "1px solid var(--accent)",
                    color: "var(--accent)",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                    padding: "6px 12px",
                    borderRadius: "8px",
                  }}
                >
                  Auto-balance
                </button>
              )}
            </div>

            {/* Combobox Search */}
            <div style={{ position: "relative", marginBottom: "20px" }}>
              <input
                type="text"
                value={searchQuery}
                onFocus={() => setIsDropdownOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsDropdownOpen(true);
                }}
                placeholder="+ Search & add stock token (e.g. NVDA, AAPL, MSFT, TSLA)..."
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  background: "var(--panel-2)",
                  border: "1px solid var(--panel-border)",
                  borderRadius: "10px",
                  color: "var(--ink)",
                  fontSize: "13px",
                  outline: "none",
                }}
              />

              {isDropdownOpen && availableAssets.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    marginTop: "6px",
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    borderRadius: "12px",
                    boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                    zIndex: 30,
                    maxHeight: "220px",
                    overflowY: "auto",
                  }}
                >
                  {availableAssets.map((asset) => (
                    <div
                      key={asset.symbol}
                      onClick={() => addToken(asset.symbol)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        cursor: "pointer",
                        borderBottom: "1px solid var(--line)",
                        transition: "background 0.15s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel-2)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <StockLogo symbol={asset.symbol} size={24} roundedFull />
                        <strong style={{ fontSize: "13px" }}>{asset.symbol}</strong>
                        <small style={{ color: "var(--muted-ink)", fontSize: "12px" }}>{asset.name}</small>
                      </div>
                      <span style={{ fontSize: "12px", color: "var(--accent)", fontWeight: 700 }}>+ Add</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Live Progress Bar */}
            {selectedAssets.length > 0 && (
              <div style={{ marginBottom: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "8px", color: "var(--muted-ink)" }}>
                  <span>Weight Allocation Breakdown</span>
                  <strong style={{ color: total === 100 ? "var(--positive)" : "var(--danger)" }}>{total}% Total</strong>
                </div>
                <div style={{ height: "10px", width: "100%", borderRadius: "99px", background: "var(--panel-2)", display: "flex", overflow: "hidden", gap: "2px" }}>
                  {selectedAssets.map((asset) => (
                    <div
                      key={asset.symbol}
                      style={{
                        width: `${targets[asset.symbol] ?? 0}%`,
                        height: "100%",
                        background: asset.color || "var(--accent)",
                      }}
                      title={`${asset.symbol}: ${targets[asset.symbol] ?? 0}%`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Sliders list */}
            {selectedAssets.length === 0 ? (
              <div
                style={{
                  padding: "36px 20px",
                  textAlign: "center",
                  background: "var(--panel-2)",
                  borderRadius: "12px",
                  border: "1px dashed var(--line)",
                }}
              >
                <p style={{ margin: 0, fontSize: "13px", color: "var(--muted-ink)" }}>
                  No stock tokens added yet. Use the search field above to pick your basket assets.
                </p>
              </div>
            ) : (
              <div className="drawer-weight-editor">
                {selectedAssets.map((asset) => (
                  <label key={asset.symbol} style={{ padding: "16px 0" }}>
                    <span>
                      <StockLogo symbol={asset.symbol} size={32} roundedFull />
                      <span>
                        <strong style={{ fontSize: "14px" }}>{asset.symbol}</strong>
                        <small>{asset.name}</small>
                      </span>
                    </span>
                    <span className="weight-actions">
                      <output style={{ fontSize: "22px" }}>{targets[asset.symbol] ?? 0}%</output>
                      <button
                        type="button"
                        onClick={() => removeToken(asset.symbol)}
                      >
                        Remove
                      </button>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={targets[asset.symbol] ?? 0}
                      onChange={(event) =>
                        setTargets((current) => ({
                          ...current,
                          [asset.symbol]: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
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
                <span style={{ color: "var(--muted-ink)" }}>Composition</span>
                <strong>{selectedAssets.length} Assets</strong>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <span style={{ fontSize: "13px", color: "var(--muted-ink)" }}>Total Allocation</span>
              <div style={{ textAlign: "right" }}>
                <strong style={{ fontSize: "18px", display: "block", color: total === 100 && selectedAssets.length > 0 ? "var(--positive)" : "var(--danger)" }}>
                  {total}%
                </strong>
                <small style={{ fontSize: "11px", color: total === 100 && selectedAssets.length > 0 ? "var(--positive)" : "var(--danger)" }}>
                  {selectedAssets.length === 0
                    ? "Add 1+ stock"
                    : total === 100
                    ? ""
                    : `${total > 100 ? "-" : "+"}${Math.abs(100 - total)}% needed`}
                </small>
              </div>
            </div>

            <button
              className="primary"
              disabled={!hasConnectedWallet || total !== 100 || selectedAssets.length === 0 || isPending}
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
