"use client";

import { useEffect, useMemo, useState } from "react";
import StockLogo from "@/components/StockLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { supportedAssets, type Basket } from "@/lib/baskets";

export type BasketAction = "mint" | "withdraw" | "rebalance" | null;

export function BasketDrawer({ basket, action, onClose }: { basket: Basket; action: Exclude<BasketAction, null>; onClose: () => void }) {
  const [targets, setTargets] = useState<Record<string, number>>(() => Object.fromEntries(basket.holdings.map((asset) => [asset.symbol, asset.target])));
  const [previewing, setPreviewing] = useState(false);
  const total = useMemo(() => Object.values(targets).reduce((sum, value) => sum + value, 0), [targets]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const backdrop = <button className="drawer-backdrop" onClick={onClose} aria-label="Close basket action"/>;

  if (action !== "rebalance") return <>{backdrop}<AmountDrawer basket={basket} kind={action} onClose={onClose}/></>;

  const selected = Object.keys(targets).map((symbol) => supportedAssets.find((asset) => asset.symbol === symbol)).filter((asset): asset is (typeof supportedAssets)[number] => Boolean(asset));
  const available = supportedAssets.filter((asset) => !(asset.symbol in targets));

  return <>{backdrop}<aside className="rebalance-drawer rebalance-editor" aria-label="Rebalance basket">
    <div className="drawer-scroll">
      <header><div><h2>{previewing ? "Staged changes" : "Rebalance"}</h2><span>{previewing ? "Preview" : "Edit weights"}</span></div><button onClick={onClose} aria-label="Close rebalance">×</button></header>
      {previewing ? <div className="safety-note"><span className="shield">✓</span><p><strong>Nothing has moved yet</strong><small>This preview is side-effect-free. Your wallet signs only after final review.</small></p></div> : <><p className="drawer-intro">Choose assets and set target weights. Nothing changes until you review and sign.</p><div className="drawer-weight-editor">{selected.map((asset) => <label key={asset.symbol}><span><StockLogo symbol={asset.symbol} size={30} roundedFull/><span><strong>{asset.symbol}</strong><small>Current {asset.current}%</small></span></span><span className="weight-actions"><output>{targets[asset.symbol]}%</output><button type="button" onClick={() => setTargets((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== asset.symbol)))} disabled={selected.length === 1}>Remove</button></span><input type="range" min="0" max="100" value={targets[asset.symbol]} onChange={(event) => setTargets((current) => ({ ...current, [asset.symbol]: Number(event.target.value) }))}/></label>)}</div>{available.length > 0 && <label className="asset-picker"><span>Add an asset</span><select value="" onChange={(event) => event.target.value && setTargets((current) => ({ ...current, [event.target.value]: 0 }))}><option value="" disabled>Select supported stock</option>{available.map((asset) => <option key={asset.symbol} value={asset.symbol}>{asset.symbol} · {asset.name}</option>)}</select></label>}<div className={`allocation-total ${total === 100 ? "valid" : "invalid"}`}><span>Total allocation</span><strong>{total}%</strong><small>{total === 100 ? "Ready to preview" : `Adjust by ${Math.abs(100 - total)}% to continue`}</small></div></>}
    </div>
    <footer><button onClick={previewing ? () => setPreviewing(false) : onClose}>{previewing ? "Edit weights" : "Cancel"}</button><button className="primary" disabled={!previewing && total !== 100} onClick={() => setPreviewing(true)}>{previewing ? "Continue" : "Review"}<AppIcon type="arrow"/></button></footer>
  </aside></>;
}

function AmountDrawer({ basket, kind, onClose }: { basket: Basket; kind: "mint" | "withdraw"; onClose: () => void }) {
  const isMint = kind === "mint";
  return <aside className="rebalance-drawer amount-drawer" aria-label={`${isMint ? "Mint" : "Withdraw"} ${basket.name}`}><div className="drawer-scroll"><header><div><h2>{isMint ? "Mint" : "Withdraw"}</h2><span>Preview</span></div><button onClick={onClose} aria-label={`Close ${kind}`}>×</button></header><p className="drawer-intro">{isMint ? "Deposit USDC to acquire the basket’s current constituent mix." : "Burn basket shares and receive the proportional underlying assets."}</p><label className="amount-field"><span>{isMint ? "You deposit" : "Shares to burn"}</span><div><input inputMode="decimal" defaultValue={isMint ? "1,000.00" : "5.00"}/><b>{isMint ? "USDC" : basket.symbol}</b></div><small>Available: {isMint ? "$2,140.00 USDC" : `238.20 ${basket.symbol}`}</small></label><div className="quote-summary"><div><span>{isMint ? "Estimated shares" : "Estimated basket value"}</span><strong>{isMint ? `9.84 ${basket.symbol}` : "$507.12"}</strong></div><div><span>Estimated network fee</span><strong>$0.01</strong></div><div><span>Quote validity</span><strong>5 minutes</strong></div></div><div className="review-note"><span className="shield">✓</span><p><strong>Review before signing</strong><small>No assets move until you approve the transaction in your wallet.</small></p></div></div><footer><button onClick={onClose}>Cancel</button><button className="primary">Review <AppIcon type="arrow"/></button></footer></aside>;
}
