"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import StockLogo from "@/components/StockLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { supportedAssets } from "@/lib/baskets";
import { extractCreatedBasketAddress, registerConfirmedBasket } from "@/lib/createSeed";
import { walletActionError } from "@/lib/walletErrors";
import { useSupportedAssets } from "@/hooks/useBaskets";

export function CreateBasketModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");

  // Search input query for adding new stock tokens
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Start with 0 stocks selected by default
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [previewing, setPreviewing] = useState(false);
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

  // Available unselected assets matching search query
  const availableAssets = useMemo(() => {
    return allSupportedAssets.filter((asset) => {
      const isNotSelected = !(asset.symbol in targets);
      const matchesSearch =
        asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        asset.name.toLowerCase().includes(searchQuery.toLowerCase());
      return isNotSelected && matchesSearch;
    });
  }, [searchQuery, targets, allSupportedAssets]);

  const publicClient = usePublicClient();
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
    if (!isConnected || !address) {
      alert("Please connect your Web3 wallet first.");
      return;
    }

    setTransactionError(null);
    try {
      const cleanName = name.trim() || "Custom Basket";
      const chainId = 31337;
      const config = CONTRACT_ADDRESSES[chainId];
      if (!publicClient) throw new Error("Wallet client is unavailable on this network.");

      const createTxHash = await writeContractAsync({
        address: config.factory,
        abi: [{
          type: "function",
          name: "createBasket",
          stateMutability: "nonpayable",
          inputs: [{ name: "name", type: "string" }],
          outputs: [{ name: "basket", type: "address" }],
        }],
        functionName: "createBasket",
        args: [cleanName],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: createTxHash });
      if (!receipt || receipt.status !== "success") throw new Error("Basket creation transaction failed.");

      const basketAddress = extractCreatedBasketAddress(receipt, config.factory);
      if (!basketAddress) throw new Error("The receipt did not contain the BasketCreated event.");

      await registerConfirmedBasket({
        chainId,
        address: basketAddress,
        controller: address,
        name: cleanName,
        symbol: symbol.trim() ? `OTH-${symbol.trim()}` : "OTH",
        createdBlock: Number(receipt.blockNumber),
        createdBlockHash: receipt.blockHash,
        createdTx: receipt.transactionHash,
        assets: selectedAssets.map((asset) => ({
          address: asset.address as string,
          targetWeightBps: (targets[asset.symbol] ?? 0) * 100,
        })),
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
              <span>{previewing ? "Review basket details before signing" : "Configure identity and target allocation"}</span>
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
                  <span>Basket Composition</span>
                  <strong>{selectedAssets.length} Assets ({total}%)</strong>
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
                Set basket details, add stock tokens to your composition, and set target weights.
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

              {/* 2. Add Stock Token Combobox */}
              <div style={{ marginBottom: "20px", position: "relative" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted-ink)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Add Stock Tokens ({selectedSymbols.length} Selected)
                  </span>
                  {selectedSymbols.length > 1 && (
                    <button
                      type="button"
                      onClick={equalizeWeights}
                      style={{
                        background: "transparent",
                        border: 0,
                        color: "var(--accent)",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      Auto-balance
                    </button>
                  )}
                </div>

                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    value={searchQuery}
                    onFocus={() => setIsDropdownOpen(true)}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setIsDropdownOpen(true);
                    }}
                    placeholder="+ Search & add stock (e.g. NVDA, AAPL, MSFT)..."
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      background: "var(--panel-2)",
                      border: "1px solid var(--panel-border)",
                      borderRadius: "10px",
                      color: "var(--ink)",
                      fontSize: "12px",
                      outline: "none",
                    }}
                  />

                  {/* Dropdown Menu when focused */}
                  {isDropdownOpen && availableAssets.length > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        marginTop: "4px",
                        background: "var(--panel)",
                        border: "1px solid var(--line)",
                        borderRadius: "10px",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                        zIndex: 20,
                        maxHeight: "180px",
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
                            padding: "8px 12px",
                            cursor: "pointer",
                            borderBottom: "1px solid var(--line)",
                            transition: "background 0.15s ease",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel-2)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <StockLogo symbol={asset.symbol} size={22} roundedFull />
                            <strong style={{ fontSize: "12px" }}>{asset.symbol}</strong>
                            <small style={{ color: "var(--muted-ink)", fontSize: "11px" }}>{asset.name}</small>
                          </div>
                          <span style={{ fontSize: "11px", color: "var(--accent)", fontWeight: 700 }}>+ Add</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 3. Live Allocation Progress Bar */}
              {selectedAssets.length > 0 && (
                <div style={{ marginBottom: "20px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "6px", color: "var(--muted-ink)" }}>
                    <span>Basket Allocation Breakdown</span>
                    <strong style={{ color: total === 100 ? "var(--positive)" : "var(--danger)" }}>{total}% Total</strong>
                  </div>
                  <div style={{ height: "8px", width: "100%", borderRadius: "99px", background: "var(--panel-2)", display: "flex", overflow: "hidden", gap: "2px" }}>
                    {selectedAssets.map((asset) => (
                      <div
                        key={asset.symbol}
                        style={{
                          width: `${targets[asset.symbol] ?? 0}%`,
                          height: "100%",
                          background: asset.color || "var(--accent)",
                          transition: "width 0.25s ease",
                        }}
                        title={`${asset.symbol}: ${targets[asset.symbol] ?? 0}%`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 4. Selected Assets List or Empty State */}
              {selectedAssets.length === 0 ? (
                <div
                  style={{
                    padding: "24px 16px",
                    textAlign: "center",
                    background: "var(--panel-2)",
                    borderRadius: "12px",
                    border: "1px dashed var(--line)",
                    marginBottom: "20px",
                  }}
                >
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--muted-ink)" }}>
                    No stock tokens added yet. Use the search input above to pick your basket assets.
                  </p>
                </div>
              ) : (
                <div className="drawer-weight-editor" style={{ paddingRight: "4px" }}>
                  {selectedAssets.map((asset) => (
                    <label key={asset.symbol}>
                      <span>
                        <StockLogo symbol={asset.symbol} size={28} roundedFull />
                        <span>
                          <strong>{asset.symbol}</strong>
                          <small>{asset.name}</small>
                        </span>
                      </span>
                      <span className="weight-actions">
                        <output>{targets[asset.symbol] ?? 0}%</output>
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
            </>
          )}

          
        </div>

        <footer style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {!previewing && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "12px",
                padding: "2px 0",
              }}
            >
              <span style={{ color: "var(--muted-ink)", fontWeight: 500 }}>Total allocation</span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <small
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: total === 100 && selectedAssets.length > 0 ? "var(--positive)" : "var(--danger)",
                  }}
                >
                  {selectedAssets.length === 0
                    ? "Add 1+ stock"
                    : total === 100
                    ? ""
                    : `${total > 100 ? "-" : "+"}${Math.abs(100 - total)}% needed`}
                </small>
                <strong
                  style={{
                    fontSize: "15px",
                    fontWeight: 700,
                    color: total === 100 && selectedAssets.length > 0 ? "var(--positive)" : "var(--ink)",
                  }}
                >
                  {total}%
                </strong>
              </div>
            </div>
          )}

          {transactionError && (
            <p role="status" style={{ margin: 0, color: "var(--muted-ink)", fontSize: "12px", textAlign: "center" }}>
              {transactionError}
            </p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "9px" }}>
            <button onClick={previewing ? () => setPreviewing(false) : onClose}>
              {previewing ? "Edit weights" : "Cancel"}
            </button>
            <button
              className="primary"
              disabled={(!previewing && (total !== 100 || selectedAssets.length === 0)) || isPending || isConfirming}
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
