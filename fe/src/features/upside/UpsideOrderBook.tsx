'use client';

import React from 'react';
import styles from './UpsideMarkets.module.css';
import { useUpsideOrderbook } from './useUpside';

interface UpsideOrderBookProps {
  chainId: number;
  seriesAddress: string;
  claimType: 'UPSIDE' | 'RESIDUAL';
}

export function UpsideOrderBook({
  chainId,
  seriesAddress,
  claimType,
}: UpsideOrderBookProps) {
  const { data: depth, isLoading, isError, refetch } = useUpsideOrderbook(chainId, seriesAddress, claimType);

  const bids = depth?.bids || [];
  const asks = depth?.asks || [];
  const recentTrades = depth?.recentTrades || [];

  return (
    <div className={styles.bookPanel}>
      <div className={styles.bookHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Order book</h2>
          <span className={styles.helperText}>
            {claimType === 'UPSIDE' ? 'Upside' : 'Remaining value'} · Prices per claim in USDC
          </span>
        </div>

      </div>

      {isError ? (
        <div className={styles.bookEmpty} role="alert">
          <strong>Book temporarily unavailable</strong>
          <p>Quotes can’t be verified right now.</p>
          <button type="button" className={styles.bookRetry} onClick={() => void refetch()}>Try again</button>
        </div>
      ) : isLoading ? (
        <div className="py-12 text-center text-xs font-mono text-zinc-500 animate-pulse">
          Loading order depth...
        </div>
      ) : bids.length === 0 && asks.length === 0 ? (
        <div className={styles.bookEmpty} role="status">
          <strong>No orders for {claimType === 'UPSIDE' ? 'Upside' : 'Remaining value'} yet</strong>
          <p>
            There are no bids or asks. Choose Limit in the trade panel to set your price and wait for a match.
          </p>
          <span>No market trades until a matching order is available.</span>
        </div>
      ) : (
        <div className={styles.bookGrid}>
          {/* Bids */}
          <div>
            <div className={styles.bookColumnTitle}>
              <span>Buyers offer</span>
              <span>Amount · Total</span>
            </div>
            <div>
              {bids.length === 0 ? (
                <div className="py-6 text-center text-[11px] font-mono text-zinc-600">No active bids</div>
              ) : (
                bids.map((b, idx) => (
                  <div key={idx} className={styles.bookRow}>
                    <span className={styles.bidPrice}>${b.priceUsd}</span>
                    <span className="text-zinc-400">
                      {(Number(b.amountClaim) / 1e8).toFixed(2)} · {(Number(b.totalClaim) / 1e8).toFixed(2)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Asks */}
          <div>
            <div className={styles.bookColumnTitle}>
              <span>Sellers ask</span>
              <span>Amount · Total</span>
            </div>
            <div>
              {asks.length === 0 ? (
                <div className="py-6 text-center text-[11px] font-mono text-zinc-600">No active asks</div>
              ) : (
                asks.map((a, idx) => (
                  <div key={idx} className={styles.bookRow}>
                    <span className={styles.askPrice}>${a.priceUsd}</span>
                    <span className="text-zinc-400">
                      {(Number(a.amountClaim) / 1e8).toFixed(2)} · {(Number(a.totalClaim) / 1e8).toFixed(2)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent Trades if any */}
      {!isError && recentTrades.length > 0 && (
        <div className="mt-6 pt-4 border-t border-[#292a27]">
          <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-2">
            Recent Trades
          </h3>
          <div className="space-y-1.5 font-mono text-xs">
            {recentTrades.slice(0, 5).map((tr) => (
              <div key={tr.id} className="flex justify-between text-zinc-400">
                <span className={tr.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>
                  {tr.side} {(Number(tr.amountClaim) / 1e8).toFixed(2)} @ ${tr.priceUsd}
                </span>
                <span className="text-zinc-500">{new Date(tr.occurredAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
