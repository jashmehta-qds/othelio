"use client";

import React, { useState } from "react";
import { BookLevel, BookTrade } from "./useRiskSplitBook";
import styles from "./RiskSplitMarkets.module.css";

interface OrderBookProps {
  claimType: "protected" | "upside";
  bids: BookLevel[];
  asks: BookLevel[];
  recentTrades: BookTrade[];
  spreadUsd: string | null;
  selectedOrderHash?: string;
  onSelectOrder?: (orderHash: string | undefined, side: "BUY" | "SELL", priceUsd: string, amountClaim: string) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  sequence: number;
}

export function OrderBook({
  claimType,
  bids,
  asks,
  recentTrades,
  spreadUsd,
  selectedOrderHash,
  onSelectOrder,
  isLoading,
  isError,
  onRetry,
}: OrderBookProps) {
  const [showFullBook, setShowFullBook] = useState(false);

  const initialDepth = 5;
  const visibleBids = showFullBook ? bids : bids.slice(0, initialDepth);
  const visibleAsks = showFullBook ? asks : asks.slice(0, initialDepth);

  const maxAskTotal = asks.length > 0 ? Number(asks[asks.length - 1].totalClaim) : 1;
  const maxBidTotal = bids.length > 0 ? Number(bids[bids.length - 1].totalClaim) : 1;
  const maxTotal = Math.max(maxAskTotal, maxBidTotal, 1);

  const claimLabel = claimType === "protected" ? "Protected" : "Upside";
  const hasMoreLevels = bids.length > initialDepth || asks.length > initialDepth;
  const isEmpty = !isLoading && !isError && bids.length === 0 && asks.length === 0;

  return (
    <div className={styles.bookWrapper}>
      <div className={styles.bookHeaderRow}>
        <div>
          <h2 className={styles.bookTitle}>Order book</h2>
          <span className={styles.bookSub}>{claimLabel} · Prices per claim in USDC</span>
        </div>
      </div>

      {isError && (
        <div role="alert" className={styles.bookUnavailable}>
          <div className={styles.bookUnavailableIcon} aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M6 9h8M6 16h5M6 23h8M19 9h7M22 16h4M19 23h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M17 6v20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="2 4" />
            </svg>
          </div>
          <strong>Book temporarily unavailable</strong>
          <span>Quotes can’t be verified right now.</span>
          <button type="button" onClick={onRetry} className={styles.bookRetryBtn}>Try again</button>
        </div>
      )}

      {isEmpty && (
        <div className={styles.bookEmptyState} role="status">
          <span className={styles.bookEmptyIcon} aria-hidden="true">≡</span>
          <strong>No orders for {claimLabel} yet</strong>
          <p>There are no bids or asks. Choose Limit in the trade panel to set your price and wait for a match.</p>
          <span>No market trades until a matching order is available.</span>
        </div>
      )}

      {/* Ladder Grid */}
      {!isError && !isEmpty && <div className={styles.bookGrid} aria-busy={isLoading}>
        {/* Buyers Side (Bids) */}
        <div className={styles.bookColumn}>
          <div className={styles.bookColumnHeader}>
            <span>Bids</span>
            <span>Size</span>
          </div>

          <div className={styles.bookLevels}>
            {isLoading ? (
              <div className={styles.bookSkeletonRows} role="status" aria-label="Loading bids">
                {[0, 1, 2].map((row) => <div key={row} className={styles.bookSkeletonRow}><span className={styles.numberSkeleton} /><span className={styles.numberSkeletonShort} /></div>)}
              </div>
            ) : bids.length === 0 ? (
              <div className={styles.bookEmptyCell}>
                No resting bids
              </div>
            ) : (
              visibleBids.map((bid, i) => {
                const depthPct = Math.min(100, Math.round((Number(bid.totalClaim) / maxTotal) * 100));
                const isSelected = Boolean(selectedOrderHash && bid.orderHash === selectedOrderHash);
                const cleanPrice = bid.priceUsd.replace("$", "");
                return (
                  <button
                    type="button"
                    key={bid.orderHash || i}
                    onClick={() => onSelectOrder?.(bid.orderHash, "SELL", cleanPrice, bid.amountClaim)}
                    className={`${styles.bookRow} ${isSelected ? styles.bookRowSelected : ""}`}
                    title="Click to target this order"
                  >
                    <div
                      className={styles.depthBarBid}
                      style={{ width: `${depthPct}%` }}
                      aria-hidden="true"
                    />
                    <span className={styles.bidPriceText}>
                      {bid.priceUsd}
                    </span>
                    <span className={styles.bookSizeText}>{bid.amountClaim}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Sellers Side (Asks) */}
        <div className={styles.bookColumn}>
          <div className={styles.bookColumnHeader}>
            <span>Asks</span>
            <span>Size</span>
          </div>

          <div className={styles.bookLevels}>
            {isLoading ? (
              <div className={styles.bookSkeletonRows} role="status" aria-label="Loading asks">
                {[0, 1, 2].map((row) => <div key={row} className={styles.bookSkeletonRow}><span className={styles.numberSkeleton} /><span className={styles.numberSkeletonShort} /></div>)}
              </div>
            ) : asks.length === 0 ? (
              <div className={styles.bookEmptyCell}>
                No resting asks
              </div>
            ) : (
              visibleAsks.map((ask, i) => {
                const depthPct = Math.min(100, Math.round((Number(ask.totalClaim) / maxTotal) * 100));
                const isSelected = Boolean(selectedOrderHash && ask.orderHash === selectedOrderHash);
                const cleanPrice = ask.priceUsd.replace("$", "");
                return (
                  <button
                    type="button"
                    key={ask.orderHash || i}
                    onClick={() => onSelectOrder?.(ask.orderHash, "BUY", cleanPrice, ask.amountClaim)}
                    className={`${styles.bookRow} ${isSelected ? styles.bookRowSelected : ""}`}
                    title="Click to target this order"
                  >
                    <div
                      className={styles.depthBarAsk}
                      style={{ width: `${depthPct}%` }}
                      aria-hidden="true"
                    />
                    <span className={styles.askPriceText}>
                      {ask.priceUsd}
                    </span>
                    <span className={styles.bookSizeText}>{ask.amountClaim}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>}

      {!isLoading && !isError && hasMoreLevels && (
        <div className={styles.seeFullBookRow}>
          <button
            type="button"
            onClick={() => setShowFullBook(!showFullBook)}
            className={styles.seeFullBookBtn}
          >
            {showFullBook ? "Show fewer levels" : `See full book (${bids.length} bids, ${asks.length} asks)`}
          </button>
        </div>
      )}

      {/* Spread Bar */}
      {!isLoading && !isError && <div className={styles.spreadBar}>
        <span>Spread: <strong>{spreadUsd ?? "—"}</strong></span>
      </div>}

      {/* Recent Confirmed Trades */}
      {!isError && recentTrades.length > 0 && (
        <div className={styles.recentTradesBox}>
          <div className={styles.recentTradesHeader}>
            Recent Confirmed Trades ({claimLabel})
          </div>
          <div className={styles.recentTradesList}>
            {recentTrades.slice(0, 5).map((tr) => (
              <div key={tr.id} className={styles.recentTradeRow}>
                <span className={tr.side === "BUY" ? styles.bidPriceText : styles.askPriceText}>
                  {tr.side} {tr.amountClaim}
                </span>
                <span>{tr.priceUsd}</span>
                <span className={styles.recentTradeTime}>
                  {new Date(tr.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
