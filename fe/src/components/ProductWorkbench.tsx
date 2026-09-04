"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

const market = [
  { symbol: "NVDAc", name: "NVIDIA", price: "$955.42", change: "+1.28%", weight: 40, tone: "nvidia" },
  { symbol: "GOOGLc", name: "Google", price: "$178.66", change: "+0.87%", weight: 30, tone: "google" },
  { symbol: "TSLA", name: "Tesla", price: "$183.24", change: "+2.31%", weight: 20, tone: "tesla" },
  { symbol: "USDC", name: "USD Coin", price: "$1.00", change: "+0.01%", weight: 10, tone: "usdc" },
];

const security = [
  ["Wallet-gated access", "/app is protected"],
  ["Agent permissions verified", "Scoped by operation"],
  ["Holdings mirrored 1:1", "Tokenized stock backing"],
  ["Rules encoded", "Allocation logic inspectable"],
];

export default function ProductWorkbench() {
  const [weights, setWeights] = useState(market.map((asset) => asset.weight));
  const total = useMemo(() => weights.reduce((sum, weight) => sum + weight, 0), [weights]);

  return (
    <main className="landing-shell">
      <header className="quote-rail" aria-label="Synthetic tokenized stock quotes">
        <Link href="/" className="wordmark" aria-label="Othelio home">Othelio</Link>
        <div className="quotes">
          {market.map((asset, index) => (
            <div className="quote" key={asset.symbol}>
              <span className={`asset-mark ${asset.tone}`} aria-hidden="true">{asset.symbol[0]}</span>
              <span className="quote-id"><strong>{asset.symbol}</strong><small>{asset.price}</small></span>
              <span className="quote-weight">{weights[index]}%</span>
              <span className="quote-change">{asset.change}</span>
              <i className="route-drop" aria-hidden="true" />
            </div>
          ))}
        </div>
        <div className="live-state"><span />Live<small>Quotes in USD</small></div>
      </header>

      <section className="workbench" aria-labelledby="hero-title">
        <aside className="promise-rail">
          <div>
            <h1 id="hero-title">Build the basket you want to own.</h1>
            <p>Create a tokenized index backed by tokenized stocks. Transparent by design. Transferable by default.</p>
            <Link className="launch-button" href="/app">Launch App <span aria-hidden="true">→</span></Link>
            <p className="wallet-note"><span className="lock-icon" aria-hidden="true" />Wallet-gated access<br /><small>/app is protected</small></p>
          </div>
          <div className="security-list">
            <h2>Security proof</h2>
            {security.map(([title, detail]) => (
              <div className="proof-row" key={title}><span className="proof-icon" aria-hidden="true" /><p><strong>{title}</strong><small>{detail}</small></p></div>
            ))}
          </div>
        </aside>

        <section className="basket-board" id="builder" aria-label="Editable synthetic basket specification">
          <div className="board-cap"><span>Basket specification</span><span>Synthetic data</span></div>
          <h2>Momentum Core</h2>
          <div className="column-head"><span>Asset</span><span>Allocation</span><span>Backing (tokenized)</span></div>
          <div className="allocation-list">
            {market.map((asset, index) => (
              <div className="allocation-row" key={asset.symbol}>
                <div className="asset-name"><span className={`asset-mark ${asset.tone}`} aria-hidden="true">{asset.symbol[0]}</span><strong>{asset.symbol}</strong></div>
                <label>
                  <span className="sr-only">{asset.symbol} allocation</span>
                  <span className="scale"><input type="range" min="0" max="100" value={weights[index]} style={{ "--fill": `${weights[index]}%` } as React.CSSProperties} onChange={(event) => setWeights((current) => current.map((weight, i) => i === index ? Number(event.target.value) : weight))} /><i><b>0%</b><b>50%</b><b>100%</b></i></span>
                  <output>{weights[index]}%</output>
                </label>
                <div className="backing"><strong>${(1042.8 * weights[index] / 100).toFixed(2)}</strong><small>{(weights[index] * 0.01332).toFixed(4)} {asset.symbol}</small></div>
              </div>
            ))}
          </div>
          <div className={`board-meta ${total === 100 ? "valid" : "invalid"}`}>
            <div><small>Total allocation</small><strong>{total.toFixed(2)}%</strong></div>
            <div><small>Rebalance rule</small><strong>Threshold 2%</strong></div>
            <div><small>Pricing source</small><strong>Oracle (USD)</strong></div>
            <div><small>Last updated</small><strong>10:15:42 UTC</strong></div>
          </div>
        </section>

        <aside className="issuance-rail">
          <div className="issuance-title">Issuance rail</div>
          <div className="token-identity"><span className="token-mark" aria-hidden="true" /><div><small>Othelio basket token</small><strong>Momentum Core</strong><span>OTHL–MCORE · ERC-20</span></div></div>
          <div className="price"><small>Index price</small><strong>$104.28</strong><span>1 OTHL–MCORE = $104.28</span></div>
          <Link className={`create-button ${total !== 100 ? "disabled" : ""}`} aria-disabled={total !== 100} href={total === 100 ? "/app?create=momentum-core" : "#builder"}>Create your basket <span aria-hidden="true">→</span></Link>
          <details className="permission" open><summary><span className="status-check" aria-hidden="true" />Agent permissions verified</summary><p>Read prices · Preview rebalance · Request execution</p></details>
          <div className="mechanism" aria-label="Basket creation mechanism">
            {[["Select", "assets"], ["Set", "allocations"], ["Mint", "index token"], ["Transfer", "freely"]].map(([action, object], index) => <div key={action}><span className={`mechanism-icon icon-${index + 1}`} aria-hidden="true"><i /></span><strong>{action}</strong><small>{object}</small></div>)}
          </div>
        </aside>
      </section>

      <section className="evidence-strip" aria-label="Product evidence with synthetic examples">
        <article><header>Public indexes <span>Synthetic data</span></header>{[["Tech Leaders", "$134.56"], ["AI Exposure", "$98.72"], ["Clean Energy", "$76.43"]].map(([name, value]) => <p key={name}><strong>{name}</strong><span>{value}</span></p>)}<Link href="/app?view=explore">View all indexes →</Link></article>
        <article><header>Portfolio history <span>Synthetic data</span></header>{[["Created", "Momentum Core", "10:15"], ["Rebalanced", "Threshold 2%", "12:02"], ["Allocation edit", "TSLA 25% → 20%", "09:41"]].map(([action, detail, time]) => <p key={action}><strong>{action}</strong><span>{detail}</span><small>{time}</small></p>)}<Link href="/app?view=history">View full history →</Link></article>
        <article><header>Agent permission lanes</header>{[["Rebalance agent", "Rebalance, Trade"], ["Risk agent", "Risk check"], ["Oracle agent", "Price read"]].map(([agent, scope]) => <p key={agent}><strong>{agent}</strong><span>{scope}</span><i className="lane-status">Active</i></p>)}<Link href="/app?view=agents">Manage permissions →</Link></article>
      </section>
    </main>
  );
}
