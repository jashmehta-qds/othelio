"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StockLogo from "@/components/StockLogo";
import styles from "./UpsideMarkets.module.css";
import {
  useUpsideAssets,
  useUpsideRounds,
  useUpsideMarkets,
} from "./useUpside";
import { UpsideChart } from "./UpsideChart";
import { UpsideOrderBook } from "./UpsideOrderBook";
import { UpsideOrderTicket } from "./UpsideOrderTicket";
import { UpsideVaultPanel } from "./UpsideVaultPanel";
import { UpsideMyOrders } from "./UpsideMyOrders";
import { upsideScenario } from "./upsideScenario";
import { useChainId } from "wagmi";

export function UpsideMarketDetail({
  seriesAddress,
}: {
  seriesAddress: string;
}) {
  const chainId = useChainId();
  const [nowSeconds, setNowSeconds] = useState(() =>
    Math.floor(Date.now() / 1000),
  );
  useEffect(() => {
    const timer = setInterval(
      () => setNowSeconds(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  const [selectedSeriesAddress, setSelectedSeriesAddress] =
    useState(seriesAddress);
  const [claimType, setClaimType] = useState<"UPSIDE" | "RESIDUAL">("UPSIDE");
  const [chosenPrice, setChosenPrice] = useState<number | null>(null);
  const assetsQuery = useUpsideAssets(chainId);
  const roundsQuery = useUpsideRounds(chainId);
  const marketsQuery = useUpsideMarkets(chainId);
  const markets = marketsQuery.data?.data ?? [];
  const activeMarket = markets.find(
    (m) =>
      m.seriesAddress.toLowerCase() === selectedSeriesAddress.toLowerCase(),
  );
  const activeRound = roundsQuery.data?.data.find(
    (r) => r.roundId === activeMarket?.roundId,
  );
  const asset = assetsQuery.data?.assets.find(
    (a) =>
      a.tokenAddress.toLowerCase() ===
      activeMarket?.underlyingAddress.toLowerCase(),
  );
  const symbol = asset?.symbol ?? "Stock";
  const name = asset?.name ?? "Tokenized stock";
  const currentPrice =
    asset?.currentPriceUsd ?? Number(activeRound?.referencePriceFormatted ?? 0);
  const roundMarkets = markets
    .filter((m) => m.roundId === activeMarket?.roundId)
    .sort(
      (a, b) => Number(a.strikePriceFormatted) - Number(b.strikePriceFormatted),
    );
  const loading =
    assetsQuery.isLoading || roundsQuery.isLoading || marketsQuery.isLoading;
  const error =
    assetsQuery.isError || roundsQuery.isError || marketsQuery.isError;
  const back = (
    <Link href="/app/upside" className={styles.backLink}>
      ← All stocks
    </Link>
  );

  if (loading || error || !activeMarket)
    return (
      <main className={`app-page-frame ${styles.page}`}>
        {back}
        <div className={styles.emptyStateText}>
          <h1>
            {loading
              ? "Loading market…"
              : error
                ? "Market unavailable"
                : "Market not found"}
          </h1>
          <p>
            {loading
              ? "Getting prices and targets."
              : error
                ? "We couldn’t load this market. Please try again."
                : "Choose another stock to continue."}
          </p>
          {error && (
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
          )}
        </div>
      </main>
    );

  const strike = Number(activeMarket.strikePriceFormatted);
  const targetChange = Number(currentPrice) > 0
    ? (strike / Number(currentPrice) - 1) * 100
    : null;
  const scenarioPrice =
    activeMarket.isSettled && activeMarket.settledPriceFormatted !== null
      ? Number(activeMarket.settledPriceFormatted)
      : (chosenPrice ?? Math.round((currentPrice || strike) * 100) / 100);
  const payout = upsideScenario(strike, scenarioPrice);
  const selectedPayout =
    claimType === "UPSIDE" ? payout.upside : payout.residual;
  const expired =
    activeMarket.isSettled || activeMarket.expiryTimestamp <= nowSeconds;
  const expiry = new Date(activeMarket.expiryTimestamp * 1000).toLocaleString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    },
  );

  return (
    <main className={`app-page-frame ${styles.page}`}>
      {back}
      <header className={styles.detailHead}>
        <div className={styles.stockHeading}>
          <StockLogo
            symbol={symbol}
            address={activeMarket.underlyingAddress}
            size={46}
          />
          <div className={styles.detailIdentity}>
            <h1>{symbol} Upside</h1>
            <p>
              {name} · Stock price ${Number(currentPrice).toFixed(2)}
            </p>
          </div>
        </div>
        <div className={styles.expiryBadge}>
          {activeMarket.isSettled ? "Settled" : expired ? "Ended" : "Ends"}{" "}
          {expiry}
        </div>
      </header>
      <section
        className={styles.targetsContainer}
        aria-label="Choose target price"
      >
        <h2 className={styles.sectionTitle}>Target price</h2>
        <div className={styles.targetsGrid}>
          {roundMarkets.map((m) => (
            <button
              key={m.seriesAddress}
              type="button"
              aria-pressed={m.seriesAddress === activeMarket.seriesAddress}
              onClick={() => setSelectedSeriesAddress(m.seriesAddress)}
              className={`${styles.targetChip} ${m.seriesAddress === activeMarket.seriesAddress ? styles.targetChipActive : ""}`}
            >
              <div className={styles.targetChipLabel}>Above</div>
              <div className={styles.targetChipStrike}>
                ${Number(m.strikePriceFormatted).toFixed(2)}
              </div>
            </button>
          ))}
        </div>
      </section>
      <div className={styles.workGrid}>
        <div className={styles.marketColumn}>
          <section className={styles.choicePanel}>
            <div
              className={styles.sideChoices}
              role="group"
              aria-label="Choose your side"
            >
              <button
                type="button"
                aria-pressed={claimType === "UPSIDE"}
                onClick={() => setClaimType("UPSIDE")}
              >
                <strong>Upside</strong>
                <span>Above ${strike.toFixed(2)} · uncapped</span>
              </button>
              <button
                type="button"
                aria-pressed={claimType === "RESIDUAL"}
                onClick={() => setClaimType("RESIDUAL")}
              >
                <strong>Remaining value</strong>
                <span>Up to ${strike.toFixed(2)}</span>
              </button>
            </div>
            <p className={styles.helperText}>
              Upside starts above ${strike.toFixed(2)}
              {targetChange !== null && ` (${targetChange >= 0 ? "+" : ""}${targetChange.toFixed(1)}% from stock price)`}.
              {" "}At or below target: zero. Remaining value falls with the stock.
            </p>
          </section>
          <UpsideOrderBook
            chainId={chainId}
            seriesAddress={activeMarket.seriesAddress}
            claimType={claimType}
          />
          <details className={`${styles.advanced} ${styles.payoutDisclosure}`}>
            <summary>Payout preview <span>Explore ending stock prices</span></summary>
            <div className={styles.scenarioBox}>
              <h3>
                {activeMarket.isSettled
                  ? "Payout at the settled stock price"
                  : "Value per claim"}
              </h3>
              {!activeMarket.isSettled && (
                <div
                  className={styles.scenarioPresets}
                  role="group"
                  aria-label="Example ending prices"
                >
                  {[
                    { label: "Below target", price: strike * 0.8 },
                    { label: "At target", price: strike },
                    { label: "Above target", price: strike * 1.2 },
                  ].map(({ label, price }) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={
                        scenarioPrice === Math.round(price * 100) / 100
                      }
                      onClick={() =>
                        setChosenPrice(Math.round(price * 100) / 100)
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <label className={styles.scenarioInput}>
                If {symbol} ends at{" "}
                <span>
                  ${" "}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={scenarioPrice}
                    disabled={activeMarket.isSettled}
                    onChange={(e) =>
                      setChosenPrice(Math.max(0, Number(e.target.value)))
                    }
                    aria-label="Ending stock price"
                  />
                </span>
              </label>
              <div className={styles.payoutPair} aria-live="polite">
                <div>
                  <span>Upside</span>
                  <strong>${payout.upside.toFixed(2)}</strong>
                </div>
                <div>
                  <span>Remaining value</span>
                  <strong>${payout.residual.toFixed(2)}</strong>
                </div>
              </div>
              <p className={styles.helperText}>
                Value per claim before purchase cost. Paid in {symbol} tokens,
                not cash.{" "}
                {activeMarket.isSettled
                  ? "Uses the settled price."
                  : "An illustration, not a forecast."}
              </p>
            </div>
          </details>
          <details className={styles.advanced}>
            <summary>Stock price history</summary>
            <UpsideChart
              chainId={chainId}
              assetAddress={activeMarket.underlyingAddress}
              symbol={symbol}
              currentPrice={Number(currentPrice)}
              strikePrice={strike}
            />
          </details>
          <UpsideMyOrders
            chainId={chainId}
            seriesAddress={activeMarket.seriesAddress}
          />
        </div>
        <div className={styles.tradeColumn}>
          <UpsideOrderTicket
            key={`${chainId}-${activeMarket.seriesAddress}`}
            chainId={chainId}
            seriesAddress={activeMarket.seriesAddress}
            strikeFormatted={activeMarket.strikePriceFormatted}
            claimType={claimType}
            symbol={symbol}
            scenarioPrice={scenarioPrice}
            scenarioPayout={selectedPayout}
            tradingClosed={expired}
            expiryTimestamp={activeMarket.expiryTimestamp}
            upsideTokenAddress={activeMarket.upsideTokenAddress}
            residualTokenAddress={activeMarket.residualTokenAddress}
            onTradeSuccess={() => {
              void marketsQuery.refetch();
            }}
          />
          <details className={styles.advanced}>
            <summary>Redeem & manage claims</summary>
            <UpsideVaultPanel
              seriesAddress={activeMarket.seriesAddress}
              underlyingAddress={activeMarket.underlyingAddress}
              symbol={symbol}
              isSettled={activeMarket.isSettled}
              settledPriceFormatted={activeMarket.settledPriceFormatted}
              onSuccess={() => {
                void marketsQuery.refetch();
              }}
            />
          </details>
          <p className={styles.helperText}>
            Both sides can lose money. Together, one of each claim represents
            one stock token. A payout is not the same as profit.
          </p>
        </div>
      </div>
    </main>
  );
}
