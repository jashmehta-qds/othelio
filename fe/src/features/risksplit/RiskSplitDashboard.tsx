"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import StockLogo from "@/components/StockLogo";
import { MarketIntro } from "@/features/markets/MarketIntro";
import { RISK_PROFILES, type RiskProfile, usdFromE8 } from "./riskSplitMarket";
import {
  useRiskSplitMarkets,
  type RiskSplitMarket,
} from "./useRiskSplitMarkets";
import { useRiskSplitBook } from "./useRiskSplitBook";
import styles from "./RiskSplitMarkets.module.css";

function MarketCard({ market }: { market: RiskSplitMarket }) {
  const { series, asset } = market;
  const protectedBook = useRiskSplitBook(series.seriesAddress, "protected", "preview");
  const upsideBook = useRiskSplitBook(series.seriesAddress, "upside", "preview");
  return (
    <article className={styles.simpleMarketCard}>
      <div className={styles.simpleMarketHead}>
        <StockLogo
          symbol={asset?.symbol ?? "Stock"}
          address={series.underlyingAddress}
          size={38}
        />
        <div>
          <h2>{asset?.symbol ?? series.underlyingAddress.slice(0, 8)}</h2>
          <p>{asset?.name ?? "Tokenized stock"}</p>
        </div>
        <strong>
          {asset?.status === "FRESH" ? usdFromE8(asset.priceUsdE8) : "—"}
          <small>Stock price</small>
        </strong>
      </div>
      <div className={styles.simpleMarketMeta}>
        Ends{" "}
        {new Date(series.expiryTimestamp * 1000).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })}
      </div>
      <div className={styles.simpleMarketSides}>
        {(
          [
            ["protected", protectedBook],
            ["upside", upsideBook],
          ] as const
        ).map(([side, book]) => (
          <Link
            key={side}
            href={`/app/risk-split/${series.seriesAddress}?side=${side}`}
          >
            <span>
              {side === "protected" ? "Protected" : "Upside"}{" "}
              <span aria-hidden="true">↗</span>
            </span>
            <strong>
              {book.isLoading
                ? "Loading…"
                : book.isError
                  ? "Price unavailable"
                  : book.bestAsk
                    ? `${book.bestAsk.priceUsd} USDC`
                    : "No offers yet"}
            </strong>
            <small>
              {book.bestAsk ? "Buy price per claim" : "View market"}
            </small>
          </Link>
        ))}
      </div>
      <details className={styles.simpleTerms}>
        <summary>Payout settings</summary>
        <p>
          Lower allocation parameter: {usdFromE8(series.floorPrice)}. Upper
          allocation parameter: {usdFromE8(series.capPrice)}. These set how the
          stock is split, not guaranteed returns. Preview exact outcomes in the
          market.
        </p>
      </details>
    </article>
  );
}

export function RiskSplitDashboard() {
  const { markets, isLoading, isError, refetch } = useRiskSplitMarkets();
  const [profile, setProfile] = useState<RiskProfile>("all");
  const [search, setSearch] = useState("");
  const visible = useMemo(
    () =>
      markets
        .filter((market) => {
          if (profile !== "all" && market.profile !== profile) return false;
          const query = search.trim().toLowerCase();
          return (
            !query ||
            [
              market.asset?.symbol,
              market.asset?.name,
              market.series.underlyingAddress,
            ]
              .join(" ")
              .toLowerCase()
              .includes(query)
          );
        })
        .sort((a, b) => a.series.expiryTimestamp - b.series.expiryTimestamp),
    [markets, profile, search],
  );

  return (
    <main className={`app-page-frame ${styles.page}`}>
      <header className={styles.heading}>
        <div>
          <h1>Risk Split</h1>
          <p>The same stock. A different balance of risk and reward.</p>
        </div>
      </header>
      <MarketIntro kind="protected" />
      <section className={styles.marketsSection} aria-label="Choose a stock">
        <div className={styles.filters}>
          <label className={styles.search}>
            <span className={styles.srOnly}>Search markets</span>
            <input
              className="ui-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search a stock"
            />
          </label>
          <label className={styles.simpleFilter}>
            Payout settings{" "}
            <select
              value={profile}
              onChange={(event) =>
                setProfile(event.target.value as RiskProfile)
              }
              aria-label="Filter by payout settings"
            >
              {RISK_PROFILES.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {isLoading ? (
          <div className={`ui-panel ${styles.state}`}>Loading markets…</div>
        ) : isError ? (
          <div className={`ui-panel ${styles.state}`}>
            <h3>Market data unavailable</h3>
            <p>We couldn’t load markets right now.</p>
            <button type="button" onClick={refetch}>
              Try again
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className={`ui-panel ${styles.state}`}>
            <h3>
              {markets.length === 0
                ? "No markets open yet"
                : "No matching stocks"}
            </h3>
            <p>
              {markets.length === 0
                ? "New markets will appear here when they launch."
                : "Try another stock or payout setting."}
            </p>
          </div>
        ) : (
          <div className={styles.simpleMarketGrid}>
            {visible.map((market) => (
              <MarketCard key={market.series.seriesAddress} market={market} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
