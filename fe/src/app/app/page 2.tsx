"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import StockLogo from "@/components/StockLogo";
import LightweightChart from "@/components/LightweightChart";

type Theme = "dark" | "light";
type NavId = "overview" | "baskets" | "activity" | "agents" | "settings";

const holdings = [
  { symbol: "NVDAc", name: "NVIDIA", target: 38, current: 38.2, value: 9424.18, tone: "lime" },
  { symbol: "AAPLc", name: "Apple", target: 31, current: 30.8, value: 7607.24, tone: "blue" },
  { symbol: "MSFTc", name: "Microsoft", target: 21, current: 21.1, value: 5201.10, tone: "slate" },
  { symbol: "USDC", name: "USD Coin", target: 10, current: 9.9, value: 2447.90, tone: "sky" },
];

const chartData = [
  { time: "2026-08-22", value: 23180 }, { time: "2026-08-24", value: 23540 },
  { time: "2026-08-26", value: 23390 }, { time: "2026-08-28", value: 23920 },
  { time: "2026-08-30", value: 24110 }, { time: "2026-09-01", value: 24360 },
  { time: "2026-09-03", value: 24680.42 },
];

const activity = [
  { action: "Rebalance preview", detail: "Adjust allocations", amount: "—", status: "Ready", time: "10:03 AM" },
  { action: "Deposit", detail: "USDC from 0x7fA3…9cB2", amount: "+1,000.00 USDC", status: "Completed", time: "Yesterday" },
  { action: "Rebalance", detail: "Across 4 assets", amount: "−410.75 USDC", status: "Completed", time: "Aug 31" },
];

const nav: { id: NavId; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "baskets", label: "Baskets" },
  { id: "activity", label: "Activity" }, { id: "agents", label: "Agents" },
  { id: "settings", label: "Settings" },
];

function Mark({ type }: { type: NavId | "theme" | "arrow" }) {
  const paths: Record<string, React.ReactNode> = {
    overview: <><path d="M4 10.5 12 4l8 6.5"/><path d="M6.5 9.5V20h11V9.5M10 20v-6h4v6"/></>,
    baskets: <><path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"/><path d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5"/></>,
    activity: <path d="M4 12h3l2-5 4 10 2-5h5"/>,
    agents: <><circle cx="12" cy="8" r="3"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></>,
    theme: <path d="M12 3a9 9 0 1 0 9 9c-5 2-11-4-9-9Z"/>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[type]}</svg>;
}

export default function AppPage() {
  const [theme, setTheme] = useState<Theme>(() => typeof window === "undefined" ? "dark" : (window.localStorage.getItem("othelio-theme") as Theme | null) ?? "dark");
  const [active, setActive] = useState<NavId>("baskets");
  const [previewOpen, setPreviewOpen] = useState(true);
  const [walletConnected, setWalletConnected] = useState(true);
  const [timeframe, setTimeframe] = useState("1M");
  const toggleTheme = () => { const next = theme === "dark" ? "light" : "dark"; setTheme(next); window.localStorage.setItem("othelio-theme", next); };
  const portfolioTotal = useMemo(() => holdings.reduce((sum, item) => sum + item.value, 0), []);

  return <main className="bank-app" data-theme={theme}>
    <aside className="bank-sidebar">
      <div><Link href="/" className="bank-wordmark">Othelio</Link><nav className="bank-nav" aria-label="Primary navigation">{nav.map((item) => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}><Mark type={item.id}/><span>{item.label}</span></button>)}</nav></div>
      <div className="sidebar-lower">
        <button className="network-control"><span className="network-dot"/><span><strong>Base Sepolia</strong><small>Connected · 84532</small></span><span>⌄</span></button>
        <section className="account-module" aria-label="Alex Carter portfolio summary">
          <header><span className="avatar">AC</span><span><strong>Alex Carter</strong><small>0x7fA3…9cB2</small></span><button aria-label="Wallet options">•••</button></header>
          <div className="account-balance"><span>Total portfolio</span><strong>${portfolioTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong><small><b>+$842.18</b> this month</small></div>
          <div className="account-available"><span>Available USDC</span><strong>$2,140.00</strong></div>
        </section>
      </div>
    </aside>

    <section className="bank-content">
      <header className="mobile-header"><Link href="/" className="bank-wordmark">Othelio</Link><button className="icon-button" onClick={toggleTheme} aria-label="Toggle color mode"><Mark type="theme"/></button></header>
      <div className="dashboard-head"><div className="crumbs"><span>Baskets</span><i>/</i><strong>Tech Leaders</strong></div><div className="head-actions"><button className="theme-toggle" onClick={toggleTheme}><Mark type="theme"/><span>{theme === "dark" ? "Light" : "Dark"} mode</span></button><button className="wallet-button" onClick={() => setWalletConnected(!walletConnected)}><span className={walletConnected ? "live-dot" : "offline-dot"}/>{walletConnected ? "0x7fA3…9cB2" : "Connect wallet"}</button></div></div>
      <section className="basket-hero">
        <div className="basket-title-row"><div className="basket-mark" aria-hidden="true"><span/><span/></div><div><h1>Tech Leaders</h1><p>Base Sepolia <i/> 0x9bDe…1a7C</p></div></div>
        <div className="basket-balance"><span>Basket value <b>Preview</b></span><div><strong>$24,680.42</strong><p><b>+$842.18</b><span>+3.53% this month</span></p></div></div>
        <div className="basket-actions"><button>Transfer</button><button>Redeem</button><button className="primary" onClick={() => setPreviewOpen(true)}>Rebalance <Mark type="arrow"/></button></div>
      </section>
      <section className="performance-block"><div className="section-title"><div><h2>Performance</h2><p>Reference NAV · synthetic preview data</p></div></div><LightweightChart data={chartData} height={200} color={theme === "dark" ? "#8aa4ff" : "#3d5fd7"} showTimeframeSelector onTimeframeChange={setTimeframe} selectedTimeframe={timeframe} theme={theme}/></section>
      <section className="allocation-block">
        <div className="section-title"><div><h2>Allocation</h2><p>Target compared with current onchain balances</p></div><div className="allocation-legend"><span><i className="target-key"/>Target</span><span><i className="current-key"/>Current</span></div></div>
        <div className="allocation-list">{holdings.map((asset) => <button className="allocation-row" key={asset.symbol}><span className="asset-identity"><StockLogo symbol={asset.symbol} size={38} roundedFull/><span><strong>{asset.symbol}</strong><small>{asset.name}</small></span></span><span className="target-value">{asset.target}%</span><span className="flow-track"><i className={`flow ${asset.tone}`} style={{ width: `${asset.current}%` }}/></span><span className="current-value"><strong>{asset.current}%</strong><small>${asset.value.toLocaleString("en-US", { minimumFractionDigits: 2 })}</small></span><span className="row-arrow">→</span></button>)}</div>
        <footer className="allocation-footer"><span>100% allocated</span><span>Last priced Sep 3, 2026 · 10:15 AM UTC</span></footer>
      </section>
      <section className="activity-block"><div className="section-title"><div><h2>Recent activity</h2><p>Confirmed and prepared basket operations</p></div><button>View all</button></div><div className="activity-table">{activity.map((item) => <div className="activity-row" key={item.action}><span className="activity-time">{item.time}</span><span><strong>{item.action}</strong><small>{item.detail}</small></span><span className="activity-amount">{item.amount}</span><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></div>)}</div></section>
    </section>

    {previewOpen && <aside className="rebalance-drawer" aria-label="Rebalance preview">
      <header><div><h2>Rebalance</h2><span>Preview</span></div><button onClick={() => setPreviewOpen(false)} aria-label="Close rebalance preview">×</button></header>
      <div className="safety-note"><span className="shield">✓</span><p><strong>Safe, staged execution</strong><small>Your wallet reviews one transaction with onchain slippage and balance checks.</small></p></div>
      <section><div className="drawer-title"><h3>Allocation changes</h3><span>Quote expires in 04:38</span></div><div className="changes-head"><span>Asset</span><span>Current</span><span>Target</span><span>Change</span></div>{holdings.map((asset) => { const delta = Number((asset.target - asset.current).toFixed(1)); return <div className="change-row" key={asset.symbol}><span><StockLogo symbol={asset.symbol} size={28} roundedFull/><b>{asset.symbol}</b></span><span>{asset.current}%</span><span>{asset.target}%</span><span className={delta >= 0 ? "positive" : "negative"}>{delta > 0 ? "+" : ""}{delta}%</span></div>; })}</section>
      <section className="execution-section"><h3>Execution details</h3><dl><div><dt>Network</dt><dd><span className="live-dot"/>Base Sepolia</dd></div><div><dt>Estimated gas</dt><dd>0.00042 ETH</dd></div><div><dt>Slippage protection</dt><dd>0.50%</dd></div><div><dt>Fail-safe</dt><dd>Revert if limits fail</dd></div></dl></section>
      <div className="review-note"><span className="shield">✓</span><p><strong>Review before signing</strong><small>No changes occur until you approve this transaction in your wallet.</small></p></div>
      <footer><button onClick={() => setPreviewOpen(false)}>Cancel</button><button className="primary">Review &amp; continue <Mark type="arrow"/></button></footer>
    </aside>}
    <nav className="mobile-nav" aria-label="Mobile navigation">{nav.slice(0,4).map((item) => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}><Mark type={item.id}/><span>{item.label}</span></button>)}</nav>
  </main>;
}
