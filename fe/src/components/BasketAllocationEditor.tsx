"use client";

import { useMemo, useState } from "react";
import StockLogo from "@/components/StockLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { supportedAssets } from "@/lib/baskets";

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

export function BasketAllocationEditor({ targets, onChange, variant = "drawer" }: { targets: BasketTargetMap; onChange: (targets: BasketTargetMap) => void; variant?: "page" | "drawer" }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const selected = Object.keys(targets).flatMap((symbol) => {
    const asset = supportedAssets.find((candidate) => candidate.symbol === symbol);
    return asset ? [asset] : [];
  });
  const total = basketTargetTotal(targets);
  const available = useMemo(() => supportedAssets.filter((asset) =>
    asset.symbol !== "USDC"
    && !(asset.symbol in targets)
    && `${asset.symbol} ${asset.name}`.toLowerCase().includes(searchQuery.trim().toLowerCase())), [searchQuery, targets]);

  const addAsset = (symbol: string) => {
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
    const symbols = Object.keys(targets);
    if (symbols.length === 0) return;
    const base = Math.floor(100 / symbols.length);
    const remainder = 100 - base * symbols.length;
    onChange(Object.fromEntries(symbols.map((item, index) => [item, base + (index === 0 ? remainder : 0)])));
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
          {available.map((asset) => <div key={asset.symbol} onClick={() => addAsset(asset.symbol)} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: isPage ? "10px 14px" : "8px 12px", cursor: "pointer", borderBottom: "1px solid var(--line)", transition: "background 0.15s ease",
          }} onMouseEnter={(event) => (event.currentTarget.style.background = "var(--panel-2)")} onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}>
            <div style={{ display: "flex", alignItems: "center", gap: isPage ? "10px" : "8px" }}>
              <StockLogo symbol={asset.symbol} size={isPage ? 24 : 22} roundedFull />
              <strong style={{ fontSize: isPage ? "13px" : "12px" }}>{asset.symbol}</strong>
              <small style={{ color: "var(--muted-ink)", fontSize: isPage ? "12px" : "11px" }}>{asset.name}</small>
            </div>
            <span style={{ fontSize: isPage ? "12px" : "11px", color: "var(--accent)", fontWeight: 700 }}>+ Add</span>
          </div>)}
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
      {selected.map((asset) => <label key={asset.symbol} style={isPage ? { padding: "16px 0" } : undefined}>
        <span><StockLogo symbol={asset.symbol} size={isPage ? 32 : 28} roundedFull /><span><strong style={isPage ? { fontSize: "14px" } : undefined}>{asset.symbol}</strong><small>{asset.name}</small></span></span>
        <span className="weight-actions"><output style={isPage ? { fontSize: "22px" } : undefined}>{targets[asset.symbol]}%</output><button type="button" onClick={() => removeAsset(asset.symbol)}>Remove</button></span>
        <input type="range" min="0" max="100" value={targets[asset.symbol]} onChange={(event) => onChange({ ...targets, [asset.symbol]: Number(event.target.value) })} />
      </label>)}
    </div>}
  </div>;
}
