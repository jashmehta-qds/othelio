"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAccount, useChainId } from "wagmi";
import { formatUnits } from "viem";
import { useAllActivity, usePortfolioOverview, usePortfolioValuationHistory } from "@/hooks/useBaskets";
import { formatAddress, getAssetSector, isUserFacingActivity, supportedAssets } from "@/lib/baskets";
import { networkLabelForChainId } from "@/lib/network";
import { useWalletRestoring } from "@/hooks/useWalletRestoring";
import { AppIcon } from "@/components/app-shell/AppIcon";
import StockLogo from "@/components/StockLogo";
import { ActivityEventRow } from "@/features/baskets/ActivityEventRow";
import { PortfolioPerformanceGraph, type Timeframe } from "./PortfolioPerformanceGraph";
import { summarizeUnrealized } from "./portfolio-summary";
import styles from "./OverviewDashboard.module.css";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const signedUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", signDisplay: "exceptZero" });

export function OverviewDashboard() {
  const chainId = useChainId() || Number(process.env.NEXT_PUBLIC_CHAIN_ID || 31337);
  const { address, isConnected } = useAccount();
  const restoring = useWalletRestoring();
  const connected = Boolean(isConnected && address);
  const overviewQuery = usePortfolioOverview(chainId, connected ? address : undefined);
  const overview = connected ? overviewQuery.data?.data : undefined;
  const [timeframe, setTimeframe] = useState<Timeframe>("30D");
  const history = usePortfolioValuationHistory(chainId, connected ? address : undefined, timeframe);
  const activity = useAllActivity(chainId, connected);
  const [choosingBasket, setChoosingBasket] = useState(false);
  const [selectedBasket, setSelectedBasket] = useState("");
  const holdingsRef = useRef<HTMLElement>(null);
  const baskets = overview?.baskets ?? [];
  const loading = restoring || (connected && overviewQuery.isLoading);
  const nav = overview?.totalNavUsdcMicro == null ? null : Number(overview.totalNavUsdcMicro) / 1e6;
  const unrealized = overview ? summarizeUnrealized(overview.holdings) : null;
  const chosenBasket = baskets.find((basket) => basket.address === selectedBasket) ?? baskets[0];

  const holdings = useMemo(() => (overview?.holdings ?? []).map((holding) => {
    const metadata = supportedAssets.find((asset) => asset.address?.toLowerCase() === holding.assetAddress.toLowerCase());
    const symbol = metadata?.symbol ?? holding.symbol ?? formatAddress(holding.assetAddress);
    const quantity = Number(formatUnits(BigInt(holding.quantityBaseUnits), holding.decimals));
    const value = holding.valueUsdcMicro === null ? null : Number(holding.valueUsdcMicro) / 1e6;
    const pnl = holding.unrealizedPnlUsdcMicro === null ? null : Number(holding.unrealizedPnlUsdcMicro) / 1e6;
    return {
      ...holding, symbol, name: metadata?.name ?? symbol, quantity, value, pnl,
      basis: value !== null && pnl !== null ? value - pnl : null,
      price: holding.priceUsdE8 === null ? null : Number(holding.priceUsdE8) / 1e8,
      weight: nav === null ? null : nav > 0 && value !== null ? value / nav * 100 : 0,
    };
  }).sort((a, b) => (b.value ?? -1) - (a.value ?? -1)), [overview, nav]);
  const largest = holdings.find((holding) => holding.symbol !== "USDC" && (holding.value ?? 0) > 0);
  const cashValue = holdings.filter((holding) => holding.symbol === "USDC").reduce((sum, holding) => sum + (holding.value ?? 0), 0);
  const cashWeight = nav !== null && nav > 0 ? cashValue / nav * 100 : null;
  const allocations = useMemo(() => {
    const sectors = new Map<string, number>();
    holdings.forEach((holding) => {
      const sector = supportedAssets.some((asset) => asset.symbol === holding.symbol) ? getAssetSector(holding.symbol) : "Other assets";
      sectors.set(sector, (sectors.get(sector) ?? 0) + (holding.value ?? 0));
    });
    return [...sectors].sort((a, b) => b[1] - a[1]);
  }, [holdings]);
  const events = connected ? (activity.data?.data ?? []).filter(isUserFacingActivity) : [];
  const recentEvents = events.slice(0, 5);
  const metricHint = loading ? "Loading your portfolio…" : !connected ? "Connect your wallet to view your portfolio" : overviewQuery.isError && !overview ? "Portfolio data is unavailable" : "Across your baskets";
  const priceTime = overview?.freshness.priceObservedAt;
  const positionTime = overview?.freshness.positionObservedAt;
  const formatUpdateTime = (timestamp: string) => new Date(timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const updateLabel = priceTime ? `Prices checked ${formatUpdateTime(priceTime)}` : "Price updates unavailable";
  const inspectExposure = () => {
    const section = holdingsRef.current;
    const row = [...(section?.querySelectorAll<HTMLDetailsElement>("details") ?? [])].find((detail) => detail.dataset.assetAddress === largest?.assetAddress);
    if (row) row.open = true;
    section?.scrollIntoView({ behavior: "auto", block: "start" });
    row?.querySelector("summary")?.focus();
  };

  return <div className={`app-page-frame ${styles.page}`}>
    <header className={styles.pageHeading}><h1 className="page-title">Your portfolio</h1><span>{networkLabelForChainId(chainId)} · USD</span></header>

    <section className={styles.actionCenter} aria-labelledby="overview-action-title">
      <div className={styles.actionIntro}><h2 id="overview-action-title">Action center</h2><p>{!connected ? "Connect your wallet to bring your baskets into view." : baskets.length === 0 && !loading ? "Create your first basket, then add funds when you’re ready." : "Your next move, without losing sight of your portfolio."}</p>
        <div className={styles.actions}>
          {baskets.length === 1 ? <Link className={styles.primary} href={`/app/baskets/${baskets[0].address}?action=mint`}>Add funds <AppIcon type="arrow" /></Link> : <button className={styles.primary} disabled={!connected || loading || baskets.length === 0} aria-expanded={choosingBasket} aria-controls="overview-fund-picker" onClick={() => setChoosingBasket(!choosingBasket)}>Add funds <AppIcon type="arrow" /></button>}
          <Link className={styles.secondary} href="/app/baskets">Manage baskets</Link>
          <Link className={styles.textAction} href="/app/baskets/create">Create basket <AppIcon type="plus" /></Link>
        </div>
      </div>
      <div className={styles.review}><span className={styles.label}>{largest ? "Worth reviewing" : "Your next step"}</span><strong>{largest?.weight != null ? `${largest.symbol} is ${largest.weight.toFixed(1)}% of your holdings` : loading ? "Bringing your portfolio into view…" : baskets.length > 0 ? "Your baskets are ready to explore" : "Build a basket around the assets you choose"}</strong>
        {largest ? <button className={styles.textAction} onClick={inspectExposure}>Inspect exposure <AppIcon type="arrow" /></button> : <Link className={styles.textAction} href={baskets.length > 0 ? "/app/baskets" : "/app/baskets/create"}>{baskets.length > 0 ? "Explore baskets" : "Start a basket"} <AppIcon type="arrow" /></Link>}
      </div>
      {choosingBasket && baskets.length > 1 && <div id="overview-fund-picker" className={styles.fundPicker}><label htmlFor="overview-basket">Choose a basket to fund</label><select id="overview-basket" value={chosenBasket?.address ?? ""} onChange={(event) => setSelectedBasket(event.target.value)}>{baskets.map((basket) => <option key={basket.address} value={basket.address}>{basket.name} · {basket.symbol}</option>)}</select><Link className={styles.secondary} href={`/app/baskets/${chosenBasket.address}?action=mint`}>Continue <AppIcon type="arrow" /></Link></div>}
    </section>

    {overviewQuery.isError && connected && <div className={styles.notice} role="status"><span>{overview ? "Couldn’t refresh your portfolio. Showing the last indexed values." : "Couldn’t load your portfolio. Try again in a moment."}</span><button className={styles.textAction} onClick={() => void overviewQuery.refetch()} disabled={overviewQuery.isFetching}>Try again <AppIcon type="sync" /></button></div>}

    <section className={styles.performance} aria-label="Portfolio value and history" aria-busy={loading}>
      <dl className={styles.tradingStrip}>
        <div><dt>Portfolio value</dt><dd>{loading ? "…" : nav === null ? "—" : usd.format(nav)}</dd><small>{metricHint}</small></div>
        <div><dt>Unrealized P&amp;L</dt><dd className={unrealized && unrealized.dollars !== 0 ? unrealized.dollars > 0 ? styles.positive : styles.negative : undefined}>{loading ? "…" : unrealized === null ? "—" : signedUsd.format(unrealized.dollars)} <span>/ {unrealized?.percent == null ? "—" : `${unrealized.percent > 0 ? "+" : ""}${unrealized.percent.toFixed(2)}`}%</span></dd><small>{loading ? "Loading cost basis…" : !connected ? "Connect your wallet" : unrealized === null ? "Cost basis or prices unavailable" : "Current holdings vs. acquisition cost"}</small></div>
        <div><dt>Realized P&amp;L</dt><dd>—</dd><small>Sale accounting unavailable</small></div>
      </dl>
      <PortfolioPerformanceGraph points={connected ? history.data?.data.points ?? [] : []} isLoading={restoring || (connected && history.isLoading)} isError={connected && history.isError} isConnected={connected} timeframe={timeframe} onTimeframeChange={setTimeframe} onRetry={() => void history.refetch()} />
      <div className={styles.performanceFooter}><span>Value includes deposits and withdrawals</span><span>{loading ? "Updating…" : !connected ? "Wallet disconnected" : <>{positionTime ? `Holdings indexed ${formatUpdateTime(positionTime)}` : "Holdings update unavailable"}<br />{updateLabel}{overview?.freshness.status === "STALE" ? " · delayed" : overview?.freshness.status === "DEGRADED" ? " · refresh interrupted" : ""}</>}</span></div>
    </section>

    <div className={styles.bottomSplit}>
      <section ref={holdingsRef} className={styles.holdings} aria-labelledby="overview-holdings-title"><div className={styles.sectionHeading}><h2 id="overview-holdings-title">Holdings</h2><span>{overview ? holdings.length : "—"} asset{holdings.length === 1 ? "" : "s"}</span></div>
        {holdings.length === 0 ? <div className={styles.empty}>{loading ? "Loading your holdings…" : !connected ? "Connect your wallet to view holdings across your baskets." : overviewQuery.isError ? "Holdings couldn’t be loaded." : "No holdings yet. Add funds to a basket to get started."}</div> : <>
          <div className={styles.tableHeading} aria-hidden="true"><span>Asset</span><span>Weight</span><span>Value</span></div>
          {holdings.map((holding) => <details className={styles.holding} key={holding.assetAddress} data-asset-address={holding.assetAddress}>
            <summary><span className={styles.asset}><StockLogo symbol={holding.symbol} address={holding.assetAddress} size={26} roundedFull /><span><strong>{holding.symbol}</strong><small>{holding.name}</small></span></span><span className={styles.weight}>{holding.weight === null ? "—" : `${holding.weight.toFixed(1)}%`}<span className={styles.weightTrack}><span style={{ width: `${Math.min(100, holding.weight ?? 0)}%` }} /></span></span><span className={styles.holdingValue}>{holding.value === null ? "—" : usd.format(holding.value)}<AppIcon type="arrow" /></span></summary>
            <div className={styles.holdingDetail}><dl><div><dt>Quantity</dt><dd>{holding.quantity.toLocaleString("en-US", { maximumFractionDigits: 8 })} units</dd></div><div><dt>Reference price</dt><dd>{holding.price === null ? "—" : usd.format(holding.price)}</dd></div><div><dt>Remaining cost basis</dt><dd>{holding.symbol === "USDC" ? "Cash" : holding.basis === null ? "—" : usd.format(holding.basis)}</dd></div><div><dt>Unrealized P&amp;L</dt><dd className={holding.pnl !== null && holding.pnl !== 0 ? holding.pnl > 0 ? styles.positive : styles.negative : undefined}>{holding.symbol === "USDC" ? "Excluded · cash" : holding.pnl === null ? "— · accounting unavailable" : signedUsd.format(holding.pnl)}</dd></div></dl><div className={styles.detailFooter}><span>Aggregated across your portfolio</span><Link className={styles.textAction} href="/app/baskets">Browse baskets <AppIcon type="arrow" /></Link></div></div>
          </details>)}
        </>}
      </section>
      <aside className={styles.context} aria-labelledby="overview-context-title"><h2 id="overview-context-title">Portfolio context</h2><dl><div><dt>Invested in assets</dt><dd>{cashWeight === null ? "—" : `${(100 - cashWeight).toFixed(1)}%`}</dd></div><div><dt>Cash</dt><dd>{cashWeight === null ? "—" : `${cashWeight.toFixed(1)}%`}</dd></div><div><dt>Largest holding</dt><dd>{largest?.weight == null ? "—" : `${largest.symbol} · ${largest.weight.toFixed(1)}%`}</dd></div><div><dt>Active baskets</dt><dd>{overview ? baskets.length : "—"}</dd></div></dl>
        {allocations.length > 0 && <details className={styles.contextDetails}><summary>Explore sector allocation <AppIcon type="arrow" /></summary><dl>{allocations.map(([sector, value]) => <div key={sector}><dt>{sector}</dt><dd>{nav !== null && nav > 0 ? `${(value / nav * 100).toFixed(1)}%` : "—"}</dd></div>)}</dl></details>}
        <details className={styles.contextDetails}><summary>How is P&amp;L calculated? <AppIcon type="arrow" /></summary><p>Unrealized P&amp;L is the current value of invested holdings minus their remaining acquisition cost. Its percentage uses that cost as the denominator; cash is excluded.</p><p>Realized P&amp;L is sale proceeds minus the cost of the assets sold. Sale accounting is not available yet, so it is shown as —. Transfers out are not automatically counted as sales.</p></details>
        {baskets.length > 0 && <details className={styles.contextDetails}><summary>Your baskets <AppIcon type="arrow" /></summary><ul className={styles.basketLinks}>{baskets.map((basket) => <li key={basket.address}><Link href={`/app/baskets/${basket.address}`}><span>{basket.name}</span><AppIcon type="arrow" /></Link></li>)}</ul></details>}
      </aside>
    </div>

    <section className={styles.recentActivity} aria-labelledby="overview-activity-title"><div className={styles.sectionHeading}><h2 id="overview-activity-title">Recent activity</h2><Link className={styles.textAction} href="/app/activity">View all <AppIcon type="arrow" /></Link></div>
      {recentEvents.length > 0 ? recentEvents.map((event, index) => <ActivityEventRow key={`${event.chainId}-${event.txHash}-${event.logIndex}`} event={event} basketSymbol={baskets.find((basket) => basket.address.toLowerCase() === event.basketAddress.toLowerCase())?.symbol} olderEvents={events.slice(index + 1)} full />) : <p className={styles.empty}>{!connected ? "Connect your wallet to see recent operations." : activity.isLoading ? "Loading confirmed operations…" : activity.isError ? "Recent activity couldn’t be loaded." : "Your confirmed deposits, rebalances, and withdrawals will appear here."}</p>}
    </section>
  </div>;
}
