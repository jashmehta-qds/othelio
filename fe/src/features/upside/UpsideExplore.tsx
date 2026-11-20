"use client";

import { useState } from "react";
import Link from "next/link";
import StockLogo from "@/components/StockLogo";
import { MarketIntro } from "@/features/markets/MarketIntro";
import styles from "./UpsideMarkets.module.css";
import {
  useUpsideAssets,
  useUpsideRounds,
  useUpsideMarkets,
} from "./useUpside";
import { useChainId } from "wagmi";

export function UpsideExplore() {
  const chainId = useChainId();
  const [searchQuery, setSearchQuery] = useState("");
  const assetsQuery = useUpsideAssets(chainId);
  const roundsQuery = useUpsideRounds(chainId);
  const marketsQuery = useUpsideMarkets(chainId);
  const assets = assetsQuery.data?.assets ?? [];
  const markets = marketsQuery.data?.data ?? [];
  const rounds = (roundsQuery.data?.data ?? []).filter((round) =>
    markets.some((m) => m.roundId === round.roundId),
  );
  const query = searchQuery.trim().toLowerCase();
  const filteredRounds = rounds.filter((round) => {
    const asset = assets.find(
      (a) =>
        a.tokenAddress.toLowerCase() === round.underlyingAddress.toLowerCase(),
    );
    return (
      !query ||
      [asset?.symbol, asset?.name].join(" ").toLowerCase().includes(query)
    );
  });
  const isLoading =
    assetsQuery.isLoading || roundsQuery.isLoading || marketsQuery.isLoading;
  const isError =
    assetsQuery.isError || roundsQuery.isError || marketsQuery.isError;

  return (
    <main className={`app-page-frame ${styles.page}`}>
      <header className={styles.heading}>
        <h1>Stock Upside</h1>
        <p>Pick a stock. Choose a target. Trade the growth above it.</p>
      </header>
      <MarketIntro kind="upside" />
      <div className={styles.filters}>
        <label className={styles.search}>
          <span className={styles.srOnly}>Search stocks</span>
          <input
            type="search"
            placeholder="Search a stock"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>
        <span className={styles.helperText}>
          Choose a stock to see its targets
        </span>
      </div>
      {isLoading ? (
        <p className={styles.emptyStateText}>Loading markets…</p>
      ) : isError ? (
        <div className={styles.emptyStateText}>
          <h2>Markets are unavailable</h2>
          <p>We couldn’t load prices right now.</p>
          <button
            type="button"
            className={styles.assetChip}
            onClick={() => {
              void assetsQuery.refetch();
              void roundsQuery.refetch();
              void marketsQuery.refetch();
            }}
          >
            Try again
          </button>
        </div>
      ) : filteredRounds.length === 0 ? (
        <div className={styles.emptyStateText}>
          <h2>{query ? "No matching stocks" : "No markets open yet"}</h2>
          <p>
            {query
              ? "Try a stock symbol or company name."
              : "New markets will appear here when they launch."}
          </p>
        </div>
      ) : (
        <div className={styles.tilesGrid}>
          {filteredRounds.map((round) => {
            const asset = assets.find(
              (a) =>
                a.tokenAddress.toLowerCase() ===
                round.underlyingAddress.toLowerCase(),
            );
            const roundMarkets = markets
              .filter((m) => m.roundId === round.roundId)
              .sort(
                (a, b) =>
                  Number(a.strikePriceFormatted) -
                  Number(b.strikePriceFormatted),
              );
            const primaryMarket = roundMarkets[0];
            const symbol = asset?.symbol ?? "Stock";
            return (
              <Link
                key={round.roundId}
                href={`/app/upside/${primaryMarket.seriesAddress}`}
                className={styles.tileCard}
              >
                <div className={styles.tileHead}>
                  <StockLogo
                    symbol={symbol}
                    address={round.underlyingAddress}
                    size={38}
                  />
                  <div className={styles.tileIdentity}>
                    <div className={styles.tileSymbol}>{symbol}</div>
                    <div className={styles.tileName}>
                      {asset?.name ?? "Tokenized stock"}
                    </div>
                  </div>
                  <div className={styles.tilePrice}>
                    <div className={styles.tileSpotPrice}>
                      $
                      {Number(
                        asset?.currentPriceUsd ?? round.referencePriceFormatted,
                      ).toFixed(2)}
                    </div>
                    <div className={styles.tileExpiry}>Stock price</div>
                  </div>
                </div>
                <div>
                  <p className={styles.helperText}>Growth above…</p>
                  <div className={styles.pricePreview}>
                    {roundMarkets.slice(0, 4).map((m) => (
                      <span key={m.seriesAddress}>
                        ${Number(m.strikePriceFormatted).toFixed(2)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className={styles.tileFooter}>
                  <span className={styles.helperText}>
                    Ends{" "}
                    {new Date(round.expiryTimestamp * 1000).toLocaleDateString(
                      "en-US",
                      {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      },
                    )}
                  </span>
                  <span className={styles.tileAction}>Choose target →</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
