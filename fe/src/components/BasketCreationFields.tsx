"use client";

import { BasketAllocationEditor, basketTargetTotal, type BasketTargetMap } from "./BasketAllocationEditor";

export function BasketCreationFields({ name, symbol, targets, onName, onSymbol, onTargets, reviewing }: { name: string; symbol: string; targets: BasketTargetMap; onName: (value: string) => void; onSymbol: (value: string) => void; onTargets: (value: BasketTargetMap) => void; reviewing: boolean }) {
  if (reviewing) return <div className="transaction-review">
    <p className="ui-notice">Creating a basket requires a wallet signature and network fees. You can add USDC after it is created.</p>
    <dl className="transaction-summary"><div><dt>Basket name</dt><dd>{name.trim() || "Custom Basket"}</dd></div><div><dt>Symbol</dt><dd>{symbol.trim() ? `OTH-${symbol.trim()}` : "OTH"}</dd></div></dl>
    <h3>Target allocation</h3>
    <dl className="transaction-summary">{Object.entries(targets).map(([asset, weight]) => <div key={asset}><dt>{asset}</dt><dd>{weight}%</dd></div>)}</dl>
    <p className="transaction-help">These are target weights. Creating the basket does not purchase assets.</p>
  </div>;
  return <div className="transaction-fields">
    <section><h3>Basket details</h3><div className="transaction-identity">
      <label className="ui-field">Basket name<input value={name} onChange={event => onName(event.target.value)} placeholder="e.g. Tech essentials" /></label>
      <label className="ui-field">Symbol <span className="transaction-optional">Optional</span><input value={symbol} onChange={event => onSymbol(event.target.value.toUpperCase())} placeholder="TECH" /></label>
    </div></section>
    <section><BasketAllocationEditor targets={targets} onChange={onTargets} variant="page" /></section>
  </div>;
}

export function BasketCreationFooter({ targets, reviewing, busy, confirming, connected, error, onBack, onContinue }: { targets: BasketTargetMap; reviewing: boolean; busy: boolean; confirming: boolean; connected: boolean; error: string | null; onBack: () => void; onContinue: () => void }) {
  const total = basketTargetTotal(targets);
  return <div className="transaction-footer">
    <div className="transaction-total"><span>Total allocation</span><strong>{total}% <small>{Object.keys(targets).length === 0 ? "Choose an asset" : total === 100 ? "Ready to review" : `${Math.abs(100 - total)}% ${total > 100 ? "over target" : "remaining"}`}</small></strong></div>
    {error && <p className="ui-notice" data-tone="error" role="alert">{error} Your details are saved here; you can try again.</p>}
    {busy && <p role="status" className="transaction-help">{confirming ? "Transaction submitted. Waiting for network confirmation…" : "Preparing your transaction. Check your wallet when prompted."}</p>}
    {!connected && <p className="transaction-help">Connect your wallet to create this basket.</p>}
    <div className="transaction-actions">{reviewing && <button className="ui-button" data-variant="secondary" disabled={busy} onClick={onBack}>Edit basket</button>}<button className="ui-button" disabled={busy || !connected || total !== 100 || Object.keys(targets).length === 0} onClick={onContinue}>{confirming ? "Waiting for confirmation…" : busy ? "Waiting for wallet…" : reviewing ? "Create basket in wallet" : "Review basket"}</button></div>
  </div>;
}
