"use client";

import { useState } from "react";
import styles from "./UpsideMarkets.module.css";
import bookStyles from "../risksplit/TradingBook.module.css";
import type { UpsideBookQuery } from "./useUpside";

interface UpsideOrderBookProps {
  bookQuery: UpsideBookQuery;
  claimType: "UPSIDE" | "RESIDUAL";
}

export function UpsideOrderBook({ bookQuery, claimType }: UpsideOrderBookProps) {
  const { data: depth, isLoading, isUnavailable: isError, refetch } = bookQuery;
  const [showFullBook, setShowFullBook] = useState(false);
  const bids = depth?.bids ?? [];
  const asks = depth?.asks ?? [];
  const recentTrades = depth?.recentTrades ?? [];
  const label = claimType === "UPSIDE" ? "Upside" : "Remaining value";
  const isEmpty = bids.length === 0 && asks.length === 0;
  const maxTotal = Math.max(...bids.map((level) => Number(level.totalClaim)), ...asks.map((level) => Number(level.totalClaim)), 1);
  const spread = bids.length && asks.length ? Number(asks[0].priceUsd) - Number(bids[0].priceUsd) : null;
  const hasMore = bids.length > 6 || asks.length > 6;

  return (
    <div className={bookStyles.book}>
      <div className={bookStyles.header}>
        <h2>Order book</h2><span className={bookStyles.meta}>{label} · USDC</span>
      </div>
      {isError ? (
        <div className={`${styles.bookEmpty} ${bookStyles.state}`} role="alert">
          <strong>Book temporarily unavailable</strong>
          <p>Quotes can’t be verified right now.</p>
          <button type="button" className={styles.bookRetry} onClick={() => void refetch()}>Try again</button>
        </div>
      ) : isLoading ? (
        <div className={`${styles.bookEmpty} ${bookStyles.state}`} role="status">Loading order depth…</div>
      ) : isEmpty ? (
        <div className={`${styles.bookEmpty} ${bookStyles.state}`} role="status">
          <strong>No orders for {label} yet</strong>
          <p>Choose Limit to set your price and wait for a match.</p>
          <span>No market trades until a matching order is available.</span>
        </div>
      ) : (
        <div className={bookStyles.grid}>
          {([{ label: "Bids", levels: bids, bid: true }, { label: "Asks", levels: asks, bid: false }] as const).map(({ label: sideLabel, levels, bid }) => (
            <div key={sideLabel} className={bookStyles.column}>
              <div className={bookStyles.columnHeader}><span>{sideLabel}</span><span>Size</span><span className={bookStyles.total}>Total</span></div>
              <div className={bookStyles.levels}>
                {levels.length === 0 ? <p className={styles.helperText}>No active {sideLabel.toLowerCase()}</p> : (showFullBook ? levels : levels.slice(0, 6)).map((level, index) => (
                  <div key={index} className={bookStyles.row}>
                    <div className={bid ? bookStyles.depthBid : bookStyles.depthAsk} style={{ width: `${Math.min(100, Number(level.totalClaim) / maxTotal * 100)}%` }} aria-hidden="true" />
                    <span className={bid ? bookStyles.bid : bookStyles.ask}>{Number(level.priceUsd).toFixed(2)}</span>
                    <span>{(Number(level.amountClaim) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                    <span className={bookStyles.total}>{(Number(level.totalClaim) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {!isLoading && !isError && <div className={bookStyles.spread}><span>Spread <b>{spread === null ? "—" : `$${spread.toFixed(2)}`}</b></span><span>Prices per claim</span></div>}
      {!isLoading && !isError && hasMore && <div className={bookStyles.footer}><span>Showing {showFullBook ? "all" : "six"} price levels</span><button type="button" onClick={() => setShowFullBook(!showFullBook)}>{showFullBook ? "Show fewer levels" : "View full book ↗"}</button></div>}
      {!isError && recentTrades.length > 0 && <details className={bookStyles.trades}>
        <summary className={styles.helperText}>Recent trades</summary>
        {recentTrades.slice(0, 5).map((trade) => <div key={trade.id} className={styles.summaryRow}><span className={trade.side === "BUY" ? bookStyles.bid : bookStyles.ask}>{trade.side} {(Number(trade.amountClaim) / 1e8).toFixed(2)} @ ${trade.priceUsd}</span><span>{new Date(trade.occurredAt).toLocaleTimeString()}</span></div>)}
      </details>}
    </div>
  );
}
