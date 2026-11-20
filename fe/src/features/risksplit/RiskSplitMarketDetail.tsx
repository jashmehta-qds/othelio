"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import StockLogo from "@/components/StockLogo";
import { PayoffVisualizer } from "./PayoffVisualizer";
import { RiskSplitClaimCards } from "./RiskSplitClaimCards";
import { RiskSplitScenario } from "./RiskSplitScenario";
import { RiskSplitActionPanel } from "./RiskSplitActionPanel";
import { useRiskSplit } from "./useRiskSplit";
import { useRiskSplitMarkets } from "./useRiskSplitMarkets";
import { useRiskSplitBook } from "./useRiskSplitBook";
import { OrderBook } from "./OrderBook";
import { OrderTicket } from "./OrderTicket";
import { MyOrders } from "./MyOrders";
import { usdFromE8 } from "./riskSplitMarket";
import { riskSplitPayoff } from "./riskSplitPayoff";
import { pickDefaultOrder } from "./tradeTicketLogic";
import styles from "./RiskSplitMarkets.module.css";

function formatExpiry(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(timestamp * 1000);
}

function formatRelativeExpiry(timestamp: number, nowSeconds: number) {
  const diffSec = timestamp - nowSeconds;
  if (diffSec <= 0) return "Expired";
  const days = Math.floor(diffSec / 86400);
  if (days > 1) return `Expires in ${days} days`;
  const hours = Math.floor(diffSec / 3600);
  if (hours > 1) return `Expires in ${hours} hours`;
  return "Expires soon";
}

export function RiskSplitMarketDetail({ seriesAddress, initialClaim = "protected" }: { seriesAddress: string; initialClaim?: "protected" | "upside" }) {
  const {
    activeSeries,
    underlyingDecimals,
    unitsCompatible,
    isLoadingList,
    isErrorList,
    refetchList,
  } = useRiskSplit(seriesAddress);

  const { assets } = useRiskSplitMarkets();

  const [selectedClaim, setSelectedClaim] = useState<"protected" | "upside">(initialClaim);
  const [marketTab, setMarketTab] = useState<"overview" | "positions">("overview");
  const [walletTab, setWalletTab] = useState<"trade" | "manage">("trade");
  const [manageTab, setManageTab] = useState<"deposit" | "claim">("deposit");
  const [ticketSide, setTicketSide] = useState<"BUY" | "SELL">("BUY");
  const [selectedOrderHash, setSelectedOrderHash] = useState<string | undefined>();
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch real order books for both Protected and Upside to display live best quotes
  const protectedBook = useRiskSplitBook(seriesAddress, "protected");
  const upsideBook = useRiskSplitBook(seriesAddress, "upside");
  const activeBook = selectedClaim === "protected" ? protectedBook : upsideBook;

  // Initialize scenario price to stock reference or mid (floor+cap)/2
  const asset = assets.find(
    (item) => item.assetAddress.toLowerCase() === activeSeries?.underlyingAddress.toLowerCase()
  );
  const stockPriceUsd = asset?.status === "FRESH" && asset.priceUsdE8
    ? Number(asset.priceUsdE8) / 1e8
    : activeSeries ? (Number(activeSeries.floorPrice) + Number(activeSeries.capPrice)) / 2e8 : 0;
  const [chosenScenarioPrice, setChosenScenarioPrice] = useState<number | null>(null);
  const scenarioPrice = chosenScenarioPrice ?? Math.round(stockPriceUsd * 100) / 100;

  if (isLoadingList) {
    return (
      <main className={`app-page-frame ${styles.page}`} aria-busy="true" aria-label="Loading market">
        <Link href="/app/risk-split" className={styles.backLink}>← All markets</Link>
        <header className={styles.detailHead}>
          <div className={styles.detailIdentity}>
            <span className={styles.skeletonLogo} />
            <div className={styles.skeletonIdentity}><span className={styles.skeletonHeading} /><span className={`${styles.skeletonText} ${styles.detailSub}`} /></div>
          </div>
          <div className={styles.detailMeta}>
            <div className={styles.detailExpiry}><span>Ends</span><strong><span className={styles.skeletonDate} /></strong></div>
          </div>
        </header>
        <div className={styles.workGrid}>
          <div className={styles.marketColumn}>
            <div className={styles.marketViewTabs} aria-hidden="true"><span className={styles.marketViewTabActive}>Overview</span><span>Positions</span></div>
            <div className={styles.marketTabPanel}>
              <section className={styles.claimChoiceSection}>
                <div className={styles.claimChoiceHead}><h2>1. Choose your side</h2><p>Two parts of the same stock</p></div>
                <div className={styles.claimSides}>
                  {(["Protected", "Upside"] as const).map((claim) => <div key={claim} className={`${styles.claimSideCard} ${styles.skeletonClaim}`}><span className={styles.claimSideName}>{claim}</span><span className={styles.skeletonText} /><div className={styles.claimSideBottom}><span className={styles.claimSideQuote}>Buy from<b><span className={styles.numberSkeleton} /></b></span><span className={styles.claimSideQuote}>Sell at<b><span className={styles.numberSkeleton} /></b></span></div></div>)}
                </div>
              </section>
              <OrderBook claimType="protected" bids={[]} asks={[]} recentTrades={[]} spreadUsd={null} isLoading isError={false} onRetry={() => {}} sequence={0} />
              </div>
          </div>
          <div className={styles.ticketColumn}>
            <div className={styles.walletActionPanel}>
              <div className={styles.walletActionTabs} aria-hidden="true"><span className={styles.walletActionTabActive}>Trade</span><span>Manage</span></div>
              <div className={`${styles.mobileClaimSwitch} ${styles.mobileClaimSkeleton}`} aria-hidden="true"><span>Protected</span><span>Upside</span></div>
              <aside className={`${styles.ticketCard} ${styles.skeletonTicket}`} aria-label="Loading trade ticket">
              <div className={styles.ticketSideToggle}><span>Buy</span><span>Sell</span></div>
              <h2 className={styles.ticketTitle}>Buy Protected</h2>
              <div className={styles.ticketModeRow}><span>Order type</span><span>Market&nbsp;&nbsp;&nbsp;Limit</span></div>
              <div className={styles.selectedOrderBanner}><span className={styles.numberSkeleton} /><span className={styles.numberSkeletonShort} /></div>
              <div className={styles.skeletonInput}><span className={styles.numberSkeleton} /></div>
              <div className={styles.ticketSummary}>{[0, 1, 2].map((item) => <div key={item} className={styles.summaryRow}><span className={styles.skeletonText} /><span className={styles.numberSkeleton} /></div>)}</div>
              <div className={styles.skeletonAction} />
              </aside>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (isErrorList) {
    return (
      <main className={`app-page-frame ${styles.page}`}>
        <Link href="/app/risk-split" className={styles.backLink}>← All markets</Link>
        <div className={`ui-panel ${styles.state}`}>
          <h3>Series data is unavailable</h3>
          <p>We could not verify this market. Try again before taking any action.</p>
          <button type="button" onClick={() => void refetchList()}>Try again</button>
        </div>
      </main>
    );
  }

  if (!activeSeries) {
    return (
      <main className={`app-page-frame ${styles.page}`}>
        <Link href="/app/risk-split" className={styles.backLink}>← All markets</Link>
        <div className={`ui-panel ${styles.state}`}>
          <h3>Series not found</h3>
          <p>This address is not in the registered Risk Split series list.</p>
        </div>
      </main>
    );
  }

  const symbol = asset?.symbol ?? "Stock token";
  const name = asset?.name ?? "Tokenized stock";
  const settledOrExpired = activeSeries.isSettled || activeSeries.expiryTimestamp <= nowSeconds;
  const stockPriceFormatted = asset?.status === "FRESH" ? usdFromE8(asset.priceUsdE8) : "—";

  const floorE8 = BigInt(activeSeries.floorPrice);
  const capE8 = BigInt(activeSeries.capPrice);
  const floor = Number(activeSeries.floorPrice) / 1e8;
  const cap = Number(activeSeries.capPrice) / 1e8;

  const currentClaimToken =
    selectedClaim === "protected"
      ? activeSeries.protectedTokenAddress || "0x0000000000000000000000000000000000000000"
      : activeSeries.upsideTokenAddress || "0x0000000000000000000000000000000000000000";

  // Resolve selected order:
  // If user explicitly clicked an order row in the book, check if it exists in current book.
  // Otherwise, default to the best single fillable order on the ticket's active side.
  let activeSelectedOrder = null;
  if (selectedOrderHash) {
    activeSelectedOrder =
      activeBook.bids.find((b) => b.orderHash === selectedOrderHash) ||
      activeBook.asks.find((a) => a.orderHash === selectedOrderHash) ||
      null;
  }
  if (!activeSelectedOrder) {
    activeSelectedOrder = pickDefaultOrder(ticketSide, activeBook.bids, activeBook.asks);
  }

  // Canonical scenario payoff calculation
  const fixingE8 = BigInt(Math.max(0, Math.round(scenarioPrice * 1e8)));
  const payoff = riskSplitPayoff(floorE8, capE8, fixingE8);
  const scenarioPayoffPerClaim =
    Number(selectedClaim === "protected" ? payoff.protectedValueE8 : payoff.upsideValueE8) / 1e8;

  const handleSelectClaim = (claim: "protected" | "upside") => {
    setSelectedClaim(claim);
    setSelectedOrderHash(undefined); // reset order selection to default best for new claim
  };

  const handleSelectBookOrder = (
    orderHash: string | undefined,
    side: "BUY" | "SELL",
  ) => {
    setSelectedOrderHash(orderHash);
    setTicketSide(side);
  };

  const handleMarketTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs = ["overview", "positions"] as const;
    const currentIndex = tabs.indexOf(marketTab);
    const nextIndex = event.key === "ArrowRight" ? (currentIndex + 1) % tabs.length
      : event.key === "ArrowLeft" ? (currentIndex - 1 + tabs.length) % tabs.length
      : event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
      : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setMarketTab(nextTab);
    document.getElementById(`market-${nextTab}-tab`)?.focus();
  };

  return (
    <main className={`app-page-frame ${styles.page}`}>
      <Link href="/app/risk-split" className={styles.backLink}>← All markets</Link>


      {/* Market information and wallet actions share one workspace. */}
      <div className={styles.workGrid}>
        <div className={`${styles.marketColumn} ${marketTab !== "overview" ? styles.marketColumnCompact : ""}`}>
          {/* 1. Header: stock reference, expiry, series status */}
          <header className={styles.detailHead}>
            <div className={styles.detailIdentity}>
              <StockLogo symbol={symbol} address={activeSeries.underlyingAddress} size={46} />
              <div>
                <h1>
                  {symbol}{" "}
                  <span className={asset?.status === "FRESH" ? styles.detailStockPrice : styles.detailStockPriceMuted}>
                    ({stockPriceFormatted})
                  </span>
                </h1>
                <p className={styles.detailSub}>
                  {name} · {settledOrExpired ? "Expired / settled" : "Open"}
                </p>
              </div>
            </div>

            <div className={styles.detailMeta}>
              <div className={styles.detailExpiry}>
                <span>Ends</span>
                <strong>{formatExpiry(activeSeries.expiryTimestamp)}</strong>
                <span className={styles.expiryTag}>
                  {formatRelativeExpiry(activeSeries.expiryTimestamp, nowSeconds)}
                </span>
              </div>
            </div>
          </header>
          <div className={styles.marketViewTabs} role="tablist" aria-label="Market view" onKeyDown={handleMarketTabKeyDown}>
            <button type="button" id="market-overview-tab" role="tab" tabIndex={marketTab === "overview" ? 0 : -1} aria-controls="market-overview-panel" aria-selected={marketTab === "overview"} className={marketTab === "overview" ? styles.marketViewTabActive : ""} onClick={() => setMarketTab("overview")}>Overview</button>
            <button type="button" id="market-positions-tab" role="tab" tabIndex={marketTab === "positions" ? 0 : -1} aria-controls="market-positions-panel" aria-selected={marketTab === "positions"} className={marketTab === "positions" ? styles.marketViewTabActive : ""} onClick={() => setMarketTab("positions")}>Positions</button>
          </div>
          <div id="market-overview-panel" role="tabpanel" aria-labelledby="market-overview-tab" hidden={marketTab !== "overview"} className={`${styles.marketTabPanel} ${styles.overviewPanel}`}>
            <RiskSplitClaimCards
              selectedClaim={selectedClaim}
              onSelectClaim={handleSelectClaim}
              protectedBestAsk={protectedBook.bestAsk}
              protectedBestBid={protectedBook.bestBid}
              upsideBestAsk={upsideBook.bestAsk}
              upsideBestBid={upsideBook.bestBid}
              protectedLoading={protectedBook.isLoading}
              upsideLoading={upsideBook.isLoading}
              protectedError={protectedBook.isError}
              upsideError={upsideBook.isError}
              stockSymbol={symbol}
            />
            <RiskSplitScenario
              scenarioPrice={scenarioPrice}
              onChangeScenarioPrice={setChosenScenarioPrice}
              selectedClaim={selectedClaim}
              floorE8={floorE8}
              capE8={capE8}
              stockSymbol={symbol}
              referencePrice={stockPriceUsd}
              maxAxis={Math.max(1, Math.ceil(stockPriceUsd * 2), Math.ceil(cap * 2.2))}
            />
            <OrderBook
              claimType={selectedClaim}
              bids={activeBook.bids}
              asks={activeBook.asks}
              recentTrades={activeBook.recentTrades}
              spreadUsd={activeBook.spreadUsd}
              selectedOrderHash={activeSelectedOrder?.orderHash}
              onSelectOrder={handleSelectBookOrder}
              isLoading={activeBook.isLoading}
              isError={activeBook.isError}
              onRetry={() => void activeBook.refetch()}
              sequence={activeBook.sequence}
            />
          </div>
          <div id="market-positions-panel" role="tabpanel" aria-labelledby="market-positions-tab" hidden={marketTab !== "positions"} className={styles.marketTabPanel}>
            <RiskSplitActionPanel seriesAddress={seriesAddress} underlyingSymbol={symbol} view="positions" />
            <MyOrders seriesAddress={seriesAddress} claimDecimals={unitsCompatible ? underlyingDecimals : null} />
          </div>
          {/* Disclosures: Payoff & Terms, Contract Details */}
          <section className={styles.disclosureSection} aria-label="Technical details and terms">
            <details className={styles.disclosureItem}>
              <summary>How these claims pay at expiry</summary>
              <p>
                This series follows the original Risk Split V1 contract deployed on Base, with floor parameter ${floor.toFixed(2)} and cap parameter ${cap.toFixed(2)}.
              </p>
              <p>
                • <b>Below ${floor.toFixed(2)}:</b> Protected receives all stock value; Upside receives zero.<br />
                • <b>From ${floor.toFixed(2)} to ${(2 * floor).toFixed(2)}:</b> Protected receives ${floor.toFixed(2)}; Upside receives the rest.<br />
                • <b>From ${(2 * floor).toFixed(2)} to ${(2 * cap).toFixed(2)}:</b> Protected and Upside each receive 50% of the stock’s value.<br />
                • <b>Above ${(2 * cap).toFixed(2)}:</b> Protected receives ${cap.toFixed(2)}; Upside receives the rest.
              </p>
              <p>
                Continuous value conservation: <code>Protected + Upside = 1 Escrowed Stock Token</code> throughout.
              </p>
              <p>
                <b>Financial truth:</b> The labels “floor” and “cap” name contract parameters, not a guaranteed return or stock-price limit. “Protected” can lose value when {symbol} falls. Settlement delivers fractions of escrowed {symbol}, not guaranteed USDC.
              </p>
              <div className={styles.chartContainerWrap}>
                <PayoffVisualizer floorPrice={floor} capPrice={cap} />
              </div>
            </details>

            <details className={styles.disclosureItem}>
              <summary>Contract details</summary>
              <p>Series address: <code>{activeSeries.seriesAddress}</code></p>
              <p>Underlying token ({symbol}): <code>{activeSeries.underlyingAddress}</code></p>
              <p>Protected claim token: <code>{activeSeries.protectedTokenAddress}</code></p>
              <p>Upside claim token: <code>{activeSeries.upsideTokenAddress}</code></p>
              <p>Settlement adapter: <code>{activeSeries.settlementAdapterAddress}</code></p>
              {activeSeries.creationFeedAddress && (
                <p>Chainlink price feed: <code>{activeSeries.creationFeedAddress}</code></p>
              )}
            </details>
          </section>
        </div>

        <div className={styles.ticketColumn}>
          <div className={styles.walletActionPanel}>
            <div className={styles.walletActionTabs} role="group" aria-label="Wallet action">
              <button type="button" aria-pressed={walletTab === "trade"} className={walletTab === "trade" ? styles.walletActionTabActive : ""} onClick={() => setWalletTab("trade")}>Trade</button>
              <button type="button" aria-pressed={walletTab === "manage"} className={walletTab === "manage" ? styles.walletActionTabActive : ""} onClick={() => setWalletTab("manage")}>Manage</button>
            </div>
            <div className={styles.walletActionBody} hidden={walletTab !== "trade"}>
              <div className={styles.mobileClaimPick}>
                <div className={styles.mobileClaimSwitch} role="group" aria-label="Choose claim">
                  <button type="button" aria-pressed={selectedClaim === "protected"} className={selectedClaim === "protected" ? styles.mobileClaimActive : ""} onClick={() => handleSelectClaim("protected")}>Protected</button>
                  <button type="button" aria-pressed={selectedClaim === "upside"} className={selectedClaim === "upside" ? styles.mobileClaimActive : ""} onClick={() => handleSelectClaim("upside")}>Upside</button>
                </div>
                <p>{selectedClaim === "protected" ? "First share at lower stock prices. You can still lose money." : "More value as the stock rises. Can finish at zero."}</p>
              </div>
              <OrderTicket
                seriesAddress={seriesAddress}
                claimType={selectedClaim}
                claimTokenAddress={currentClaimToken}
                claimDecimals={unitsCompatible ? underlyingDecimals : null}
                symbol={symbol}
                seriesExpiryTimestamp={activeSeries.expiryTimestamp}
                tradingClosed={settledOrExpired}
                scenarioPrice={scenarioPrice}
                scenarioPayoffPerClaim={scenarioPayoffPerClaim}
                selectedOrder={activeSelectedOrder}
                isBookLoading={activeBook.isLoading}
                isBookError={activeBook.isError}
                side={ticketSide}
                onChangeSide={(side) => {
                  setTicketSide(side);
                  setSelectedOrderHash(undefined);
                }}
                onOrderCreated={() => {
                  protectedBook.refetch();
                  upsideBook.refetch();
                }}
              />
            </div>
            <div className={styles.walletActionBody} hidden={walletTab !== "manage"}>
              <div className={styles.manageActionTabs} role="group" aria-label="Manage claims">
                <button type="button" aria-pressed={manageTab === "deposit"} className={manageTab === "deposit" ? styles.manageActionTabActive : ""} onClick={() => setManageTab("deposit")}>Deposit</button>
                <button type="button" aria-pressed={manageTab === "claim"} className={manageTab === "claim" ? styles.manageActionTabActive : ""} onClick={() => setManageTab("claim")}>Claim</button>
              </div>
              <RiskSplitActionPanel seriesAddress={seriesAddress} underlyingSymbol={symbol} view={manageTab} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
