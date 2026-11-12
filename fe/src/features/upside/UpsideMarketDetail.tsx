'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import styles from './UpsideMarkets.module.css';
import {
  useUpsideAssets,
  useUpsideRounds,
  useUpsideMarkets,
} from './useUpside';
import { UpsideChart } from './UpsideChart';
import { UpsideOrderBook } from './UpsideOrderBook';
import { UpsideOrderTicket } from './UpsideOrderTicket';
import { UpsideVaultPanel } from './UpsideVaultPanel';
import { UpsideMyOrders } from './UpsideMyOrders';
import { useChainId } from 'wagmi';

interface UpsideMarketDetailProps {
  seriesAddress: string;
}

const TARGET_PRESETS = [
  { label: 'Starting Price', desc: 'Reference baseline' },
  { label: 'Reach', desc: '+0.5σ Target' },
  { label: 'Strong Move', desc: '+1.0σ Target' },
  { label: 'Long Shot', desc: '+2.0σ Target' },
];

export function UpsideMarketDetail({ seriesAddress: initialSeriesAddress }: UpsideMarketDetailProps) {
  const chainId = useChainId();
  const [selectedSeriesAddress, setSelectedSeriesAddress] = useState<string>(initialSeriesAddress);

  const { data: assetsData, isLoading: isLoadingAssets } = useUpsideAssets(chainId);
  const { data: roundsData, isLoading: isLoadingRounds } = useUpsideRounds(chainId);
  const { data: marketsData, isLoading: isLoadingMarkets, refetch: refetchMarkets } = useUpsideMarkets(chainId);

  const assets = assetsData?.assets || [];
  const rounds = roundsData?.data || [];
  const markets = marketsData?.data || [];

  // Active market
  const activeMarket = useMemo(() => {
    return (
      markets.find(
        (m) => m.seriesAddress.toLowerCase() === selectedSeriesAddress.toLowerCase(),
      ) ||
      markets.find(
        (m) => m.seriesAddress.toLowerCase() === initialSeriesAddress.toLowerCase(),
      )
    );
  }, [markets, selectedSeriesAddress, initialSeriesAddress]);

  // Round for active market
  const activeRound = useMemo(() => {
    if (!activeMarket) return null;
    return rounds.find((r) => r.roundId === activeMarket.roundId) || null;
  }, [rounds, activeMarket]);

  // All sibling markets for this round (targets)
  const roundMarkets = useMemo(() => {
    if (!activeRound) return [];
    return markets
      .filter((m) => m.roundId === activeRound.roundId)
      .sort((a, b) => Number(a.strikePrice) - Number(b.strikePrice));
  }, [markets, activeRound]);

  // Underlying asset
  const underlyingAsset = useMemo(() => {
    if (!activeRound) return null;
    return (
      assets.find(
        (a: any) => a.tokenAddress.toLowerCase() === activeRound.underlyingAddress.toLowerCase(),
      ) || null
    );
  }, [assets, activeRound]);

  const symbol = underlyingAsset?.symbol || 'STOCK';
  const name = underlyingAsset?.name || 'Tokenized Stock';
  const currentPrice = underlyingAsset?.currentPriceUsd || (activeRound ? Number(activeRound.referencePriceFormatted) : 0);

  if (isLoadingMarkets || isLoadingRounds || isLoadingAssets) {
    return (
      <main className={`app-page-frame ${styles.page}`}>
        <Link href="/app/upside" className={styles.backLink}>
          ← Back to Upside Markets
        </Link>
        <div className="py-20 text-center font-mono text-zinc-500 animate-pulse">
          Loading market details from Base...
        </div>
      </main>
    );
  }

  if (!activeMarket) {
    return (
      <main className={`app-page-frame ${styles.page}`}>
        <Link href="/app/upside" className={styles.backLink}>
          ← Back to Upside Markets
        </Link>
        <div className="py-20 text-center border border-dashed border-[#292a27] rounded-xl p-8 space-y-4">
          <h2 className="text-xl font-bold text-white">Market Not Found</h2>
          <p className="text-zinc-400 text-sm max-w-md mx-auto">
            The requested Upside series ({initialSeriesAddress.slice(0, 10)}...) is not recognized on Base chain {chainId}.
          </p>
          <Link
            href="/app/upside"
            className="inline-block px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            Explore All Markets
          </Link>
        </div>
      </main>
    );
  }

  const strikeNum = Number(activeMarket.strikePriceFormatted);
  const activeIndex = roundMarkets.findIndex(
    (m) => m.seriesAddress.toLowerCase() === activeMarket.seriesAddress.toLowerCase(),
  );
  const targetLabel =
    activeIndex >= 0 && activeIndex < TARGET_PRESETS.length
      ? TARGET_PRESETS[activeIndex].label
      : `Target ${activeIndex + 1}`;

  const expiryDate = new Date(activeMarket.expiryTimestamp * 1000);
  const expiryFormatted = expiryDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <main className={`app-page-frame ${styles.page}`}>
      <Link href="/app/upside" className={styles.backLink}>
        ← Back to Upside Markets
      </Link>

      {/* Header */}
      <header className={styles.detailHead}>
        <div className={styles.detailIdentity}>
          <h1>{symbol} Upside</h1>
          <p>
            {name} · Continuous upside vs residual value conservation
          </p>
          <div className={styles.detailPriceBlock}>
            <span className={styles.detailPrice}>${currentPrice.toFixed(2)}</span>
            <span className="text-xs font-mono text-zinc-500">Spot Oracle Observation</span>
          </div>
        </div>

        <div className={styles.detailMeta}>
          <div className={styles.expiryBadge}>
            Expires {expiryFormatted}
          </div>
          {activeMarket.isSettled ? (
            <div className="px-3 py-1.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700 text-xs font-semibold">
              Settled at ${activeMarket.settledPriceFormatted}
            </div>
          ) : (
            <div className="px-3 py-1.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800 text-xs font-semibold">
              Active Trading
            </div>
          )}
        </div>
      </header>

      {/* 4 Targets Chip Selector */}
      <section className={styles.targetsContainer}>
        <div className={styles.targetsTitle}>Select Target Strike:</div>
        <div className={styles.targetsGrid}>
          {roundMarkets.map((m, idx) => {
            const preset = TARGET_PRESETS[idx] || {
              label: `Target ${idx + 1}`,
              desc: 'Custom Strike',
            };
            const isCurrent = m.seriesAddress.toLowerCase() === activeMarket.seriesAddress.toLowerCase();

            return (
              <button
                key={m.seriesAddress}
                type="button"
                onClick={() => setSelectedSeriesAddress(m.seriesAddress)}
                className={`${styles.targetChip} ${isCurrent ? styles.targetChipActive : ''}`}
              >
                <div className={styles.targetChipLabel}>{preset.label}</div>
                <div className={styles.targetChipStrike}>${m.strikePriceFormatted}</div>
                <div className={styles.targetChipDesc}>{preset.desc}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Work Grid: 2 Columns */}
      <div className={styles.workGrid}>
        {/* Left Column: Chart, OrderBook, My Orders */}
        <div>
          <UpsideChart
            chainId={chainId}
            assetAddress={activeRound?.underlyingAddress || activeMarket.underlyingAddress}
            symbol={symbol}
            currentPrice={currentPrice}
            strikePrice={strikeNum}
          />

          <UpsideOrderBook
            chainId={chainId}
            seriesAddress={activeMarket.seriesAddress}
            strikeFormatted={activeMarket.strikePriceFormatted}
          />

          <UpsideMyOrders
            chainId={chainId}
            seriesAddress={activeMarket.seriesAddress}
          />
        </div>

        {/* Right Column: Order Ticket & Vault Management */}
        <div>
          <UpsideOrderTicket
            chainId={chainId}
            seriesAddress={activeMarket.seriesAddress}
            strikeFormatted={activeMarket.strikePriceFormatted}
            targetLabel={targetLabel}
            upsideTokenAddress={activeMarket.upsideTokenAddress}
            residualTokenAddress={activeMarket.residualTokenAddress}
            onTradeSuccess={() => {
              refetchMarkets();
            }}
          />

          <UpsideVaultPanel
            seriesAddress={activeMarket.seriesAddress}
            underlyingAddress={activeRound?.underlyingAddress || activeMarket.underlyingAddress}
            symbol={symbol}
            isSettled={activeMarket.isSettled}
            settledPriceFormatted={activeMarket.settledPriceFormatted}
            onSuccess={() => {
              refetchMarkets();
            }}
          />
        </div>
      </div>
    </main>
  );
}
