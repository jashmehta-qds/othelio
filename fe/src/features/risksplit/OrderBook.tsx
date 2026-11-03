"use client";

import React from "react";
import { BookLevel, BookTrade } from "./useRiskSplitBook";
import styles from "./RiskSplitMarkets.module.css";

interface OrderBookProps {
  claimType: "protected" | "upside";
  bids: BookLevel[];
  asks: BookLevel[];
  recentTrades: BookTrade[];
  spreadUsd: string | null;
  onSelectPrice?: (priceUsd: string, side: "BUY" | "SELL", orderHash?: string) => void;
  isLoading: boolean;
  sequence: number;
}

export function OrderBook({
  claimType,
  bids,
  asks,
  recentTrades,
  spreadUsd,
  onSelectPrice,
  isLoading,
}: OrderBookProps) {
  const maxAskTotal = asks.length > 0 ? Number(asks[asks.length - 1].totalClaim) : 1;
  const maxBidTotal = bids.length > 0 ? Number(bids[bids.length - 1].totalClaim) : 1;
  const maxTotal = Math.max(maxAskTotal, maxBidTotal, 1);

  return (
    <div className="space-y-4">
      {/* Ladder Grid */}
      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
        {/* Bids Side */}
        <div className="bg-[#10110f] border border-[#292a27] rounded-lg p-3">
          <div className="flex justify-between text-zinc-500 pb-2 border-b border-[#292a27] text-[11px] uppercase tracking-wider">
            <span>Bid Price</span>
            <span>Size (Claims)</span>
          </div>

          <div className="divide-y divide-[#1e1f1c] mt-1 min-h-[140px]">
            {bids.length === 0 ? (
              <div className="py-12 text-center text-zinc-600">No resting bids</div>
            ) : (
              bids.slice(0, 8).map((bid, i) => {
                const depthPct = Math.min(100, Math.round((Number(bid.totalClaim) / maxTotal) * 100));
                return (
                  <div
                    key={i}
                    onClick={() => onSelectPrice?.(bid.priceUsd.replace('$', ''), 'SELL', bid.orderHash)}
                    className="relative flex justify-between py-1 px-1 cursor-pointer hover:bg-[#1a2e22] transition-colors group"
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-emerald-950/40 pointer-events-none"
                      style={{ width: `${depthPct}%` }}
                    />
                    <span className="relative font-semibold text-emerald-400 group-hover:underline">
                      {bid.priceUsd}
                    </span>
                    <span className="relative text-zinc-300">{bid.amountClaim}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Asks Side */}
        <div className="bg-[#10110f] border border-[#292a27] rounded-lg p-3">
          <div className="flex justify-between text-zinc-500 pb-2 border-b border-[#292a27] text-[11px] uppercase tracking-wider">
            <span>Ask Price</span>
            <span>Size (Claims)</span>
          </div>

          <div className="divide-y divide-[#1e1f1c] mt-1 min-h-[140px]">
            {asks.length === 0 ? (
              <div className="py-12 text-center text-zinc-600">No resting asks</div>
            ) : (
              asks.slice(0, 8).map((ask, i) => {
                const depthPct = Math.min(100, Math.round((Number(ask.totalClaim) / maxTotal) * 100));
                return (
                  <div
                    key={i}
                    onClick={() => onSelectPrice?.(ask.priceUsd.replace('$', ''), 'BUY', ask.orderHash)}
                    className="relative flex justify-between py-1 px-1 cursor-pointer hover:bg-[#381a1c] transition-colors group"
                  >
                    <div
                      className="absolute inset-y-0 right-0 bg-red-950/40 pointer-events-none"
                      style={{ width: `${depthPct}%` }}
                    />
                    <span className="relative font-semibold text-red-400 group-hover:underline">
                      {ask.priceUsd}
                    </span>
                    <span className="relative text-zinc-300">{ask.amountClaim}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Spread Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 rounded bg-[#161715] border border-[#292a27] text-xs font-mono text-zinc-400">
        <span>Spread: {spreadUsd ? <strong className="text-zinc-200">{spreadUsd}</strong> : "—"}</span>
        <span className="text-[10px] text-zinc-500">Quotes settled via 0x Protocol on Base</span>
      </div>

      {/* Recent Trades */}
      {recentTrades.length > 0 && (
        <div className="border border-[#292a27] rounded-lg p-3 bg-[#10110f] text-xs font-mono space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
            Recent Confirmed Trades ({claimType.toUpperCase()})
          </div>
          <div className="divide-y divide-[#1c1d1a] max-h-[120px] overflow-y-auto">
            {recentTrades.slice(0, 5).map((tr) => (
              <div key={tr.id} className="flex justify-between py-1 text-[11px]">
                <span className={tr.side === "BUY" ? "text-emerald-400" : "text-red-400"}>
                  {tr.side} {tr.amountClaim}
                </span>
                <span className="text-zinc-200">{tr.priceUsd}</span>
                <span className="text-zinc-500">
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
