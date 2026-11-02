"use client";

import { useState } from "react";
import Link from "next/link";
import StockLogo from "@/components/StockLogo";
import { PayoffVisualizer } from "./PayoffVisualizer";
import { RiskSplitActionPanel } from "./RiskSplitActionPanel";
import { useRiskSplit } from "./useRiskSplit";
import { useRiskSplitMarkets } from "./useRiskSplitMarkets";
import { profileForSeries, RISK_PROFILES, usdFromE8 } from "./riskSplitMarket";
import styles from "./RiskSplitMarkets.module.css";

function formatExpiry(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(timestamp * 1000);
}

export function RiskSplitMarketDetail({ seriesAddress }: { seriesAddress: string }) {
  const { activeSeries, balances, isLoadingList, isErrorList, refetchList } = useRiskSplit(seriesAddress);
  const { assets } = useRiskSplitMarkets();
  const [claim, setClaim] = useState<"protected" | "upside">("protected");
  const [nowSeconds] = useState(() => Math.floor(Date.now() / 1000));

  if (isLoadingList) return <main className={`app-page-frame ${styles.page}`}><Link href="/app/risk-split" className={styles.backLink}>← All markets</Link><div className={`ui-panel ${styles.state}`}>Loading series…</div></main>;
  if (isErrorList) return <main className={`app-page-frame ${styles.page}`}><Link href="/app/risk-split" className={styles.backLink}>← All markets</Link><div className={`ui-panel ${styles.state}`}><h3>Series data is unavailable</h3><p>We could not verify this market. Try again before taking any action.</p><button type="button" onClick={() => void refetchList()}>Try again</button></div></main>;
  if (!activeSeries) return <main className={`app-page-frame ${styles.page}`}><Link href="/app/risk-split" className={styles.backLink}>← All markets</Link><div className={`ui-panel ${styles.state}`}><h3>Series not found</h3><p>This address is not in the registered Risk Split series list.</p></div></main>;

  const asset = assets.find((item) => item.assetAddress.toLowerCase() === activeSeries.underlyingAddress.toLowerCase());
  const symbol = asset?.symbol ?? "Stock token";
  const profile = RISK_PROFILES.find((item) => item.key === profileForSeries(activeSeries))?.label ?? "Other";
  const settledOrExpired = activeSeries.isSettled || activeSeries.expiryTimestamp <= nowSeconds;
  const stockPrice = asset?.status === "FRESH" ? usdFromE8(asset.priceUsdE8) : "—";
  const floor = Number(activeSeries.floorPrice) / 1e8;
  const cap = Number(activeSeries.capPrice) / 1e8;

  return <main className={`app-page-frame ${styles.page}`}>
    <Link href="/app/risk-split" className={styles.backLink}>← All markets</Link>
    <header className={styles.detailHead}>
      <div className={styles.detailIdentity}><StockLogo symbol={symbol} address={activeSeries.underlyingAddress} size={42} /><div><h1>{symbol} Risk Split</h1><p>{asset?.name ?? "Tokenized stock"} · {profile} · {settledOrExpired ? "Expired / settled" : "Open"}</p></div></div>
      <div className={styles.detailMeta}><div><span>Stock reference</span><strong>{stockPrice}</strong></div><div><span>Protected floor / cap</span><strong>{usdFromE8(activeSeries.floorPrice)} / {usdFromE8(activeSeries.capPrice)}</strong></div><div><span>Expiry</span><strong>{formatExpiry(activeSeries.expiryTimestamp)}</strong></div></div>
    </header>
    <div className={styles.balances}><div><span>In wallet</span><strong>{balances.underlying} {symbol}</strong></div><div><span>Protected</span><strong>{balances.protected}</strong></div><div><span>Upside</span><strong>{balances.upside}</strong></div></div>
    <div className={styles.workGrid}>
      <section className={`ui-panel ${styles.bookPanel}`} aria-labelledby="order-book-heading">
        <div className={styles.panelHeading}><h2 id="order-book-heading">Order book</h2><span>USDC quoted · no live venue</span></div>
        <div className={styles.bookTabs} role="tablist" aria-label="Claim book">
          <button type="button" role="tab" aria-selected={claim === "protected"} onClick={() => setClaim("protected")}>Protected / USDC</button>
          <button type="button" role="tab" aria-selected={claim === "upside"} onClick={() => setClaim("upside")}>Upside / USDC</button>
        </div>
        <div className={styles.bookGrid}><div className={styles.bookSide}><h3>Bids</h3><div><span>Price</span><span>Size</span></div></div><div className={styles.bookSide}><h3>Asks</h3><div><span>Price</span><span>Size</span></div></div></div>
        <div className={styles.bookEmpty}><strong>Order book not connected</strong><p>There are no verified bids, asks or recent trades for this series yet.</p></div>
      </section>
      <aside className={`ui-panel ${styles.ticketPanel}`} aria-label="Limit order ticket">
        <div className={styles.panelHeading}><h2>Limit order</h2><span>{claim === "protected" ? "Protected" : "Upside"}</span></div>
        <div className={styles.orderSides}><button type="button" disabled>Buy</button><button type="button" disabled>Sell</button></div>
        <label className={styles.orderField}>Limit price · USDC<input value="" readOnly disabled placeholder="—" /></label>
        <label className={styles.orderField}>Amount · claims<input value="" readOnly disabled placeholder="—" /></label>
        <button type="button" className={styles.disabledAction} disabled>Trading unavailable</button>
        <p>Order entry opens when an executable venue is connected and this series has a verified book.</p>
        <a href="#payoff" className={styles.openLink}>Understand this payoff ↗</a>
      </aside>
    </div>
    <div className={styles.belowGrid}><section><h2>Mint pair & manage claims</h2><RiskSplitActionPanel seriesAddress={seriesAddress} underlyingSymbol={symbol} /></section><section><h2>Market terms</h2><div className={`ui-panel ${styles.bookPanel}`}><div className={styles.bookSide}><div><span>One {symbol} deposited</span><strong>1 Protected + 1 Upside</strong></div><div><span>Protected floor</span><strong>{usdFromE8(activeSeries.floorPrice)}</strong></div><div><span>Protected cap</span><strong>{usdFromE8(activeSeries.capPrice)}</strong></div><div><span>Expiry fixing</span><strong>{formatExpiry(activeSeries.expiryTimestamp)}</strong></div><div><span>Reference state</span><strong>{asset?.status ?? "Unavailable"}</strong></div></div></div></section></div>
    <section id="payoff" className={styles.payoffSection}><h2>Payoff & terms</h2><p>Explore the stock-token allocation at expiry. The simulation is not a live quote for either claim.</p><PayoffVisualizer key={activeSeries.seriesAddress} floorPrice={floor} capPrice={cap} /></section>
    <details className={styles.technical}><summary>Contract details</summary><p>Series: <code>{activeSeries.seriesAddress}</code></p><p>Underlying: <code>{activeSeries.underlyingAddress}</code></p><p>Protected: <code>{activeSeries.protectedTokenAddress}</code></p><p>Upside: <code>{activeSeries.upsideTokenAddress}</code></p></details>
  </main>;
}
