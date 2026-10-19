"use client";

import { useMemo, useState } from "react";
import StockLogo from "@/components/StockLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { supportedAssets, type Holding } from "@/lib/baskets";
import { useSupportedAssets } from "@/hooks/useBaskets";

export type BasketTargetMap = Record<string, number>;

export function basketTargetAssets(targets: BasketTargetMap) {
  return Object.entries(targets).flatMap(([symbol, weight]) => {
    const asset = supportedAssets.find((candidate) => candidate.symbol === symbol);
    if (!asset?.address || weight <= 0) return [];
    return [{ address: asset.address, targetWeightBps: Math.round(weight * 100) }];
  });
}

export function basketTargetTotal(targets: BasketTargetMap) {
  return Object.values(targets).reduce((sum, weight) => sum + weight, 0);
}

function formatPaddedPercent(val: number): string {
  const rounded = Math.round(Math.abs(val) * 100) / 100;
  const parts = rounded.toFixed(2).split(".");
  const integerPart = parts[0].padStart(2, "0");
  return `${integerPart}.${parts[1]}`;
}

export function BasketAllocationEditor({ targets, onChange, variant = "drawer" }: { targets: BasketTargetMap; onChange: (targets: BasketTargetMap) => void; variant?: "page" | "drawer" }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { data: catalogData } = useSupportedAssets();

  const allAssets: Holding[] = useMemo(() => {
    if (!catalogData?.data?.length) return supportedAssets;
    return catalogData.data.map((item) => {
      const fallback = supportedAssets.find((a) => a.symbol === item.symbol || a.address?.toLowerCase() === item.assetAddress.toLowerCase());
      return {
        symbol: item.symbol ?? fallback?.symbol ?? "",
        name: item.name ?? fallback?.name ?? "",
        target: 0,
        current: 0,
        quantity: 0,
        value: 0,
        color: fallback?.color ?? "#8aa4ff",
        address: item.assetAddress ?? fallback?.address,
        tradeable: item.tradeable ?? (item.status !== "UNAVAILABLE" && item.priceUsdE8 != null),
      };
    });
  }, [catalogData]);

  const selected = Object.keys(targets).flatMap((symbol) => {
    const asset = allAssets.find((candidate) => candidate.symbol === symbol);
    return asset ? [asset] : [];
  });
  const total = basketTargetTotal(targets);
  const available = useMemo(() => allAssets
    .filter((asset) =>
      asset.symbol !== "USDC"
      && !(asset.symbol in targets)
      && `${asset.symbol} ${asset.name}`.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    .sort((a, b) => {
      const aTradeable = a.tradeable !== false;
      const bTradeable = b.tradeable !== false;
      if (aTradeable !== bTradeable) return aTradeable ? -1 : 1;
      return a.symbol.localeCompare(b.symbol);
    }),
    [allAssets, searchQuery, targets]
  );

  const addAsset = (symbol: string) => {
    const asset = allAssets.find((candidate) => candidate.symbol === symbol);
    if (asset && asset.tradeable === false) return;

    const symbols = [...Object.keys(targets), symbol];
    const base = Math.floor(100 / symbols.length);
    const remainder = 100 - base * symbols.length;
    onChange(Object.fromEntries(symbols.map((item, index) => [item, base + (index === 0 ? remainder : 0)])));
    setSearchQuery("");
    setIsDropdownOpen(false);
  };

  const removeAsset = (symbol: string) => {
    const symbols = Object.keys(targets).filter((item) => item !== symbol);
    if (symbols.length === 0) {
      onChange({});
      return;
    }
    const base = Math.floor(100 / symbols.length);
    const remainder = 100 - base * symbols.length;
    onChange(Object.fromEntries(symbols.map((item, index) => [item, base + (index === 0 ? remainder : 0)])));
  };

  const splitEvenly = () => {
    const operableSymbols = Object.keys(targets).filter((sym) => {
      const asset = allAssets.find((candidate) => candidate.symbol === sym);
      return asset?.tradeable !== false;
    });
    if (operableSymbols.length === 0) return;
    const base = Math.floor(100 / operableSymbols.length);
    const remainder = 100 - base * operableSymbols.length;
    const next: Record<string, number> = {};
    Object.keys(targets).forEach((sym) => {
      next[sym] = 0;
    });
    operableSymbols.forEach((item, index) => {
      next[item] = base + (index === 0 ? remainder : 0);
    });
    onChange(next);
  };

  const isPage = variant === "page";

  return <div>
    <div style={{ marginBottom: isPage ? "20px" : "20px", position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isPage ? "16px" : "8px" }}>
        {isPage ? <div>
          <h3 style={{ fontSize: "15px", fontWeight: 700 }}>2. Basket Composition</h3>
          <span style={{ fontSize: "12px", color: "var(--muted-ink)" }}>Select tokenized stocks to include in index</span>
        </div> : <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted-ink)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Add Stock Tokens ({selected.length} Selected)
        </span>}
        <button type="button" className="equalize-weights-button" onClick={splitEvenly} disabled={selected.length < 2}>
          <AppIcon type="sync" /> Split evenly
        </button>
      </div>
      <div style={{ position: "relative" }}>
        <input
          value={searchQuery}
          onFocus={() => setIsDropdownOpen(true)}
          onChange={(event) => { setSearchQuery(event.target.value); setIsDropdownOpen(true); }}
          placeholder={isPage ? "+ Search & add stock token (e.g. NVDA, AAPL, MSFT, TSLA)..." : "+ Search & add stock (e.g. NVDA, AAPL, MSFT)..."}
          style={{
            width: "100%",
            padding: isPage ? "12px 14px" : "9px 12px",
            background: "var(--panel-2)",
            border: "1px solid var(--panel-border)",
            borderRadius: "10px",
            color: "var(--ink)",
            fontSize: isPage ? "13px" : "12px",
            outline: "none",
          }}
        />
        {isDropdownOpen && available.length > 0 && <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, marginTop: isPage ? "6px" : "4px",
          background: "var(--panel)", border: "1px solid var(--line)", borderRadius: isPage ? "12px" : "10px",
          boxShadow: isPage ? "0 12px 32px rgba(0,0,0,0.4)" : "0 8px 24px rgba(0,0,0,0.4)",
          zIndex: 30, maxHeight: isPage ? "220px" : "180px", overflowY: "auto",
        }}>
          {available.map((asset) => {
            const isTradeable = asset.tradeable !== false;
            return (
              <div
                key={asset.symbol}
                onClick={() => isTradeable && addAsset(asset.symbol)}
                title={isTradeable ? undefined : "This asset is not currently enabled for trading on Base mainnet."}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: isPage ? "10px 14px" : "8px 12px",
                  cursor: isTradeable ? "pointer" : "not-allowed",
                  opacity: isTradeable ? 1 : 0.5,
                  borderBottom: "1px solid var(--line)",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(event) => {
                  if (isTradeable) event.currentTarget.style.background = "var(--panel-2)";
                }}
                onMouseLeave={(event) => {
                  if (isTradeable) event.currentTarget.style.background = "transparent";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: isPage ? "10px" : "8px" }}>
                  <StockLogo symbol={asset.symbol} size={isPage ? 24 : 22} roundedFull />
                  <strong style={{ fontSize: isPage ? "13px" : "12px" }}>{asset.symbol}</strong>
                  <small style={{ color: "var(--muted-ink)", fontSize: isPage ? "12px" : "11px" }}>{asset.name}</small>
                </div>
                {isTradeable ? (
                  <span style={{ fontSize: isPage ? "12px" : "11px", color: "var(--accent)", fontWeight: 700 }}>+ Add</span>
                ) : (
                  <span
                    style={{
                      fontSize: isPage ? "11px" : "10px",
                      color: "var(--muted-ink)",
                      background: "var(--panel-2)",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      border: "1px solid var(--panel-border)",
                      fontWeight: 600,
                    }}
                  >
                    Unavailable
                  </span>
                )}
              </div>
            );
          })}
        </div>}
      </div>
    </div>

    {selected.length > 0 && <div style={{ marginBottom: isPage ? "24px" : "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: isPage ? "12px" : "11px", marginBottom: isPage ? "8px" : "6px", color: "var(--muted-ink)" }}>
        <span>{isPage ? "Weight Allocation Breakdown" : "Basket Allocation Breakdown"}</span>
        <strong style={{ color: total === 100 ? "var(--positive)" : "var(--danger)" }}>{total}% Total</strong>
      </div>
      <div style={{ height: isPage ? "10px" : "8px", width: "100%", borderRadius: "99px", background: "var(--panel-2)", display: "flex", overflow: "hidden", gap: "2px" }}>
        {selected.map((asset) => <div key={asset.symbol} title={`${asset.symbol}: ${targets[asset.symbol]}%`} style={{ width: `${targets[asset.symbol]}%`, height: "100%", background: asset.color || "var(--accent)", transition: "width 0.25s ease" }} />)}
      </div>
    </div>}

    {selected.length === 0 ? <div style={{
      padding: isPage ? "36px 20px" : "24px 16px", textAlign: "center", background: "var(--panel-2)",
      borderRadius: "12px", border: "1px dashed var(--line)", marginBottom: isPage ? 0 : "20px",
    }}>
      <p style={{ margin: 0, fontSize: isPage ? "13px" : "12px", color: "var(--muted-ink)" }}>
        No stock tokens added yet. Use the search {isPage ? "field" : "input"} above to pick your basket assets.
      </p>
    </div> : <div className="drawer-weight-editor" style={isPage ? undefined : { paddingRight: "4px" }}>
      {selected.map((asset) => {
        const isTradeable = asset.tradeable !== false;
        return (
          <label key={asset.symbol} style={isPage ? { padding: "16px 0" } : undefined}>
            <span>
              <StockLogo symbol={asset.symbol} size={isPage ? 32 : 28} roundedFull />
              <span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <strong style={isPage ? { fontSize: "14px" } : undefined}>{asset.symbol}</strong>
                  {!isTradeable && (
                    <span style={{
                      fontSize: "10px",
                      color: "var(--muted-ink)",
                      background: "var(--panel-2)",
                      padding: "1px 5px",
                      borderRadius: "4px",
                      border: "1px solid var(--panel-border)",
                      fontWeight: 600,
                    }}>
                      Unavailable
                    </span>
                  )}
                </span>
                <small>{asset.name}</small>
              </span>
            </span>
            <span className="weight-actions">
              <output style={isPage ? { fontSize: "22px" } : undefined}>{formatPaddedPercent(targets[asset.symbol] ?? 0)}%</output>
              <button type="button" onClick={() => removeAsset(asset.symbol)}>Remove</button>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              disabled={!isTradeable}
              value={targets[asset.symbol]}
              onChange={(event) => onChange({ ...targets, [asset.symbol]: Number(event.target.value) })}
            />
          </label>
        );
      })}
    </div>}
  </div>;
}
