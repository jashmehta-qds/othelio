'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import styles from './UpsideMarkets.module.css';
import { useUpsideAssets, useUpsideRounds, useUpsideMarkets } from './useUpside';
import { useChainId } from 'wagmi';

export function UpsideExplore() {
  const chainId = useChainId();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAssetSymbol, setSelectedAssetSymbol] = useState<string>('ALL');

  const { data: assetsData, isLoading: isLoadingAssets } = useUpsideAssets(chainId);
  const { data: roundsData, isLoading: isLoadingRounds } = useUpsideRounds(chainId);
  const { data: marketsData, isLoading: isLoadingMarkets } = useUpsideMarkets(chainId);

  const assets = assetsData?.assets || [];
  const rounds = roundsData?.data || [];
  const markets = marketsData?.data || [];

  // Group markets by round
  const roundMap = useMemo(() => {
    const map = new Map<number, typeof markets>();
    for (const m of markets) {
      const list = map.get(m.roundId) || [];
      list.push(m);
      map.set(m.roundId, list);
    }
    return map;
  }, [markets]);

  // Unique supported asset symbols for filter chips
  const assetSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets) {
      if (a.isEligibleForUpside) {
        set.add(a.symbol);
      }
    }
    return Array.from(set);
  }, [assets]);

  // Filtered rounds
  const filteredRounds = useMemo(() => {
    return rounds.filter((r) => {
      const asset = assets.find(
        (a: any) => a.tokenAddress.toLowerCase() === r.underlyingAddress.toLowerCase(),
      );
      const symbol = asset?.symbol || 'STOCK';
      const name = asset?.name || '';

      if (selectedAssetSymbol !== 'ALL' && symbol !== selectedAssetSymbol) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return symbol.toLowerCase().includes(q) || name.toLowerCase().includes(q);
      }

      return true;
    });
  }, [rounds, assets, selectedAssetSymbol, searchQuery]);

  return (
    <main className={`app-page-frame ${styles.page}`}>
      <div className={styles.heading}>
        <h1>Stock Upside Markets</h1>
        <p>
          Trade continuous upside on tokenized stocks. Hold upside claims above strike targets
          or harvest premiums with residual claims.
        </p>
      </div>

      {/* Filters & Search */}
      <div className={styles.filters}>
        <div className={styles.search}>
          <input
            type="text"
            placeholder="Search by stock symbol or company name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className={styles.assetChips}>
          <button
            type="button"
            onClick={() => setSelectedAssetSymbol('ALL')}
            className={`${styles.assetChip} ${selectedAssetSymbol === 'ALL' ? styles.assetChipActive : ''}`}
          >
            All Stocks
          </button>
          {assetSymbols.map((sym) => (
            <button
              key={sym}
              type="button"
              onClick={() => setSelectedAssetSymbol(sym)}
              className={`${styles.assetChip} ${selectedAssetSymbol === sym ? styles.assetChipActive : ''}`}
            >
              {sym}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Rounds / Stock Markets */}
      {isLoadingRounds && rounds.length === 0 ? (
        <div className="py-16 text-center text-zinc-500 font-mono text-sm">
          Loading Upside markets from Base...
        </div>
      ) : filteredRounds.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-[#292a27] rounded-xl p-8 space-y-3">
          <h3 className="text-lg font-semibold text-white">No Upside Markets Found</h3>
          <p className="text-zinc-400 text-sm max-w-md mx-auto">
            {searchQuery
              ? `No markets match "${searchQuery}". Try searching for another token.`
              : 'There are currently no active Upside rounds deployed on this network.'}
          </p>
        </div>
      ) : (
        <div className={styles.tilesGrid}>
          {filteredRounds.map((round) => {
            const asset = assets.find(
              (a: any) => a.tokenAddress.toLowerCase() === round.underlyingAddress.toLowerCase(),
            );
            const symbol = asset?.symbol || 'STOCK';
            const name = asset?.name || 'Tokenized Stock';
            const spotPrice = asset?.currentPriceUsd || round.referencePriceFormatted;
            const roundMarkets = roundMap.get(round.roundId) || [];

            // Primary series for direct navigation (e.g. first strike)
            const primarySeries = roundMarkets[0]?.seriesAddress || '0x0000000000000000000000000000000000000000';
            const expiryStr = new Date(round.expiryTimestamp * 1000).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });

            return (
              <Link
                key={round.roundId}
                href={`/app/upside/${primarySeries}`}
                className={styles.tileCard}
              >
                <div>
                  <div className={styles.tileHead}>
                    <div>
                      <div className={styles.tileSymbol}>{symbol}</div>
                      <div className={styles.tileName}>{name}</div>
                    </div>
                    <div className={styles.tilePrice}>
                      <div className={styles.tileSpotPrice}>${Number(spotPrice).toFixed(2)}</div>
                      <div className={styles.tileExpiry}>Expires {expiryStr}</div>
                    </div>
                  </div>

                  {/* 4 targets preview */}
                  <div className={`mt-4 ${styles.targetsBreakdown}`}>
                    <div className={styles.targetMiniItem}>
                      <span>Start</span>
                      <span>${round.referencePriceFormatted}</span>
                    </div>
                    <div className={styles.targetMiniItem}>
                      <span>Reach</span>
                      <span>+0.5σ</span>
                    </div>
                    <div className={styles.targetMiniItem}>
                      <span>Strong</span>
                      <span>+1.0σ</span>
                    </div>
                    <div className={styles.targetMiniItem}>
                      <span>Long Shot</span>
                      <span>+2.0σ</span>
                    </div>
                  </div>
                </div>

                <div className={styles.tileFooter}>
                  <span className="text-zinc-400 font-mono text-[11px]">
                    {roundMarkets.length || 4} Target Strikes
                  </span>
                  <span className={styles.tileAction}>Trade Targets →</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
