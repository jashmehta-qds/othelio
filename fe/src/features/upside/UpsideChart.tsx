'use client';

import React, { useMemo } from 'react';
import styles from './UpsideMarkets.module.css';
import { useUpsideStockHistory } from './useUpside';

interface UpsideChartProps {
  chainId: number;
  assetAddress: string;
  symbol: string;
  currentPrice: number;
  strikePrice?: number;
}

export function UpsideChart({
  chainId,
  assetAddress,
  symbol,
  currentPrice,
  strikePrice,
}: UpsideChartProps) {
  const { data, isLoading } = useUpsideStockHistory(chainId, assetAddress);
  const points = data?.history || [];

  const chartData = useMemo(() => {
    if (points.length < 2) return null;

    const prices = points.map((p: any) => p.priceUsd);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const range = maxPrice - minPrice || 1;

    // SVG viewbox dimensions: 500 x 140 (leave padding)
    const width = 500;
    const height = 140;
    const padding = 15;

    const coords = points.map((p: any, idx: number) => {
      const x = padding + (idx / (points.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((p.priceUsd - minPrice) / range) * (height - 2 * padding);
      return { x, y, price: p.priceUsd, time: p.timestamp };
    });

    const pathD = coords.reduce((acc: string, c: any, idx: number) => `${acc} ${idx === 0 ? 'M' : 'L'} ${c.x} ${c.y}`, '');
    const fillD = `${pathD} L ${coords[coords.length - 1].x} ${height} L ${coords[0].x} ${height} Z`;

    return {
      minPrice,
      maxPrice,
      pathD,
      fillD,
      coords,
    };
  }, [points]);

  return (
    <div className={styles.chartPanel}>
      <div className={styles.chartHeader}>
        <div>
          <h2>{symbol} Price Chart</h2>
          <span className="text-xs font-mono text-zinc-500">
            Chainlink Oracle feed observations on Base
          </span>
        </div>
        <div className="text-right font-mono">
          <span className="text-sm font-bold text-white">${currentPrice.toFixed(2)}</span>
          <span className="block text-[10px] text-zinc-500">Latest Spot</span>
        </div>
      </div>

      {isLoading ? (
        <div className="h-44 flex items-center justify-center text-xs font-mono text-zinc-500">
          Loading price observations...
        </div>
      ) : !chartData ? (
        <div className="h-44 flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#292a27] rounded-lg">
          <span className="text-xs font-mono text-zinc-400">Honest Feed Tracking</span>
          <span className="text-[11px] font-mono text-zinc-500 mt-1">
            Historical price observations will populate automatically as Chainlink rounds are logged.
          </span>
          <div className="mt-3 px-3 py-1 rounded bg-[#10110f] border border-[#292a27] text-xs font-mono text-emerald-400 font-bold">
            Current Price: ${currentPrice.toFixed(2)}
          </div>
        </div>
      ) : (
        <div>
          <svg viewBox="0 0 500 140" className={styles.chartSvg}>
            <defs>
              <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Gradient fill */}
            <path d={chartData.fillD} fill="url(#chartGradient)" />

            {/* Line */}
            <path
              d={chartData.pathD}
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          <div className="flex justify-between text-[10px] font-mono text-zinc-500 pt-2 border-t border-[#292a27]">
            <span>Low: ${chartData.minPrice.toFixed(2)}</span>
            <span>{points.length} onchain observations</span>
            <span>High: ${chartData.maxPrice.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
