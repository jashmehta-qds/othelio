"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import StockLogo from "@/components/StockLogo";
import { RISK_PROFILES, type RiskProfile, usdFromE8 } from "./riskSplitMarket";
import { useRiskSplitMarkets } from "./useRiskSplitMarkets";
import styles from "./RiskSplitMarkets.module.css";

function expiryLabel(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(timestamp * 1000);
}

export function RiskSplitDashboard() {
  const { markets, isLoading, isError, refetch } = useRiskSplitMarkets();
  const [profile, setProfile] = useState<RiskProfile>("all");
  const [search, setSearch] = useState("");
  const counts = useMemo(() => Object.fromEntries(RISK_PROFILES.map(({ key }) => [key, key === "all" ? markets.length : markets.filter((market) => market.profile === key).length])) as Record<RiskProfile, number>, [markets]);
  const visible = useMemo(() => markets.filter((market) => {
    if (profile !== "all" && market.profile !== profile) return false;
    const query = search.trim().toLowerCase();
    return !query || [market.asset?.symbol, market.asset?.name, market.series.underlyingAddress].join(" ").toLowerCase().includes(query);
  }).sort((a, b) => a.series.expiryTimestamp - b.series.expiryTimestamp), [markets, profile, search]);

  return <main className={`app-page-frame ${styles.page}`}>
    <header className={styles.heading}>
      <div><h1>Risk Split</h1><p>Protected and Upside claims for tokenized stocks.</p></div>
    </header>
    <section className={styles.marketsSection} aria-label="Markets">
      <div className={styles.profileTabs} role="tablist" aria-label="Risk profile">
        {RISK_PROFILES.map((item) => <button type="button" role="tab" aria-selected={profile === item.key} key={item.key} onClick={() => setProfile(item.key)}>
          {item.label}<span>{counts[item.key]}</span>
        </button>)}
      </div>
      <div className={styles.filters}>
        <label className={styles.search}><span className={styles.srOnly}>Search markets</span><input className="ui-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search stock or token" /></label>
      </div>
      {isLoading ? <div className={`ui-panel ${styles.state}`}>Loading markets…</div>
        : isError ? <div className={`ui-panel ${styles.state}`}><h3>Market data unavailable</h3><p>We could not load the series registry.</p><button type="button" onClick={refetch}>Try again</button></div>
        : visible.length === 0 ? <div className={`ui-panel ${styles.state}`}><h3>{markets.length === 0 ? "No markets open yet" : "No markets match these filters"}</h3><p>{markets.length === 0 ? "New markets will appear here when they launch." : "Try another profile or search term."}</p></div>
        : <div className={styles.tableScroll}><table className={styles.marketTable}>
          <thead><tr><th>Stock / series</th><th>Profile</th><th>Stock reference</th><th>Protected bid / ask · USDC</th><th>Upside bid / ask · USDC</th><th>Pair arb</th><th>Expiry</th><th><span className={styles.srOnly}>Open</span></th></tr></thead>
          <tbody>{visible.map(({ series, asset, profile: profileKey }) => <tr key={series.seriesAddress}>
            <td><div className={styles.stockCell}><StockLogo symbol={asset?.symbol ?? "Stock"} address={series.underlyingAddress} size={30} /><div><strong>{asset?.symbol ?? series.underlyingAddress.slice(0, 6) + "…"}</strong><span>{asset?.name ?? "Tokenized stock"}</span></div></div></td>
            <td><span className={styles.profileTag}>{RISK_PROFILES.find((item) => item.key === profileKey)?.label}</span></td>
            <td><strong>{asset?.status === "FRESH" ? usdFromE8(asset.priceUsdE8) : "—"}</strong><small>{asset?.status === "FRESH" ? "Oracle reference" : "Reference stale / unavailable"}</small></td>
            <td className={styles.noQuote}>— <small>Book unavailable</small></td>
            <td className={styles.noQuote}>— <small>Book unavailable</small></td>
            <td className={styles.noQuote}>— <small>No executable quotes</small></td>
            <td className={styles.expiry}>{expiryLabel(series.expiryTimestamp)}</td>
            <td><Link className={styles.openLink} href={"/app/risk-split/" + series.seriesAddress}>Open <span aria-hidden="true">↗</span></Link></td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  </main>;
}
