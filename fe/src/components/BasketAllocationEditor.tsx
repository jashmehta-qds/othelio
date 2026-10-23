"use client";

import { useMemo, useState } from "react";
import "./transactions.css";
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

  return <div className="allocation-editor" data-variant={variant}>
    <div className="allocation-heading"><div><h3>Assets & allocation</h3><p>Choose stocks and set their share of your basket.</p></div><button type="button" className="ui-button" data-variant="secondary" onClick={splitEvenly} disabled={selected.length < 2}><AppIcon type="sync" /> Split evenly</button></div>
    <div className="allocation-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setIsDropdownOpen(false); }}>
      <label className="ui-field"><span className="ui-field-header"><span>Find an asset</span></span><input value={searchQuery} onFocus={() => setIsDropdownOpen(true)} onChange={event => { setSearchQuery(event.target.value); setIsDropdownOpen(true); }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setIsDropdownOpen(false); } }} placeholder="Search by name or symbol" aria-expanded={isDropdownOpen} aria-controls="allocation-results" /></label>
      {isDropdownOpen && <div id="allocation-results" className="allocation-results">
        {available.length === 0 ? <p className="transaction-help">No matching assets. Try another name or symbol.</p> : available.map(asset => <button type="button" key={asset.symbol} disabled={asset.tradeable === false} onClick={() => addAsset(asset.symbol)} className="allocation-result"><StockLogo symbol={asset.symbol} size={26} roundedFull /><span><strong>{asset.symbol}</strong><small>{asset.name}</small></span><span>{asset.tradeable === false ? "Unavailable" : "Add"}</span></button>)}
      </div>}
    </div>
    {selected.length === 0 ? <div className="ui-state allocation-empty"><h4>Build your basket</h4><p>Search for a stock to start. Adding or removing an asset splits weights evenly.</p></div> : <>
      <div className="transaction-total"><span>{selected.length} assets selected</span><strong>{total}% allocated</strong></div>
      <div className="allocation-rows">{selected.map(asset => <div className="allocation-row" key={asset.symbol}>
        <div className="allocation-asset"><StockLogo symbol={asset.symbol} size={28} roundedFull /><span><strong>{asset.symbol}</strong><small>{asset.name}{asset.tradeable === false ? " · Unavailable" : ""}</small></span></div>
        <label className="allocation-weight"><input aria-label={`${asset.symbol} target percentage`} type="number" min="0" max="100" step="0.01" disabled={asset.tradeable === false} value={targets[asset.symbol]} onChange={event => onChange({ ...targets, [asset.symbol]: Math.min(100, Math.max(0, Number(event.target.value) || 0)) })} /><span>%</span></label>
        <button type="button" className="ui-button" data-variant="ghost" aria-label={`Remove ${asset.symbol}`} onClick={() => removeAsset(asset.symbol)}>Remove</button>
        <input className="allocation-slider" aria-label={`${asset.symbol} allocation slider`} type="range" min="0" max="100" disabled={asset.tradeable === false} value={targets[asset.symbol]} onChange={event => onChange({ ...targets, [asset.symbol]: Number(event.target.value) })} />
      </div>)}</div><p className="transaction-help">Adding or removing assets splits the allocation evenly. Adjust individual weights to suit your basket.</p>
    </>}
  </div>;
}
