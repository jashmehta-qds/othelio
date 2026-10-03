"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { formatUnits } from "viem";
import { useAllActivity, usePortfolioOverview, usePortfolioValuationHistory } from "@/hooks/useBaskets";
import {
  formatAddress,
  formatCompactNumber,
  getAssetChange,
  getAssetSector,
  getCreatedBaskets,
  getLocalActivity,
  isUserFacingActivity,
  SECTOR_COLORS,
  supportedAssets,
  type Basket,
} from "@/lib/baskets";
import { SectorDonutChart, type SectorAllocation } from "./SectorDonutChart";
import { PortfolioPerformanceGraph } from "./PortfolioPerformanceGraph";
import { useWalletRestoring } from "@/hooks/useWalletRestoring";
import StockLogo from "@/components/StockLogo";

type Timeframe = "1D" | "7D" | "30D";

const SECTOR_CATEGORIES = [
  "Big Tech & AI",
  "Fintech & Crypto Infrastructure",
  "Semiconductors & Hardware",
  "Aerospace & Next-Gen",
  "USD & Cash Equiv",
] as const;

export function OverviewDashboard() {
  const defaultChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 31337);
  const chainId = useChainId() || defaultChainId;
  const { address, isConnected } = useAccount();
  const isWalletRestoring = useWalletRestoring();
  const [localBaskets, setLocalBaskets] = useState<Basket[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>("30D");

  // Load created baskets from local storage
  useEffect(() => {
    if (typeof window !== "undefined") {
      setLocalBaskets(getCreatedBaskets());
      const handleStorage = () => {
        setLocalBaskets(getCreatedBaskets());
      };
      window.addEventListener("storage", handleStorage);
      window.addEventListener("basket_updated", handleStorage);
      return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener("basket_updated", handleStorage);
      };
    }
  }, []);

  const { data: overviewResponse } = usePortfolioOverview(chainId, isConnected ? address : undefined);
  const indexedBaskets = overviewResponse?.data?.baskets || [];
  const { data: valuationHistory, isLoading: isValuationHistoryLoading } = usePortfolioValuationHistory(
    chainId,
    isConnected ? address : undefined,
    timeframe,
  );

  // Fetch recent activity feed
  const { data: activityRes } = useAllActivity(chainId, Boolean(isConnected && address));
  const indexedEvents = activityRes?.data || [];

  // Combine active baskets (User Created -> Backend Indexed) - Strict 0 when disconnected
  // Combine active baskets (Backend Indexed -> User Created Fallback) - Strict 0 when disconnected
  const candidateBaskets = useMemo<Basket[]>(() => {
    if (!isConnected || !address) return [];

    const basketMap = new Map<string, Basket>();

    // 1. Process indexed baskets first (authoritative on-chain / backend state)
    indexedBaskets.forEach((ib) => {
      if (ib.controller && ib.controller.toLowerCase() !== address.toLowerCase()) {
        return;
      }
      const basketObj: Basket = {
        name: ib.name,
        symbol: ib.symbol || "OTH",
        value: 0,
        change: 0.0,
        updated: ib.createdAt ? new Date(ib.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Recently",
        address: ib.address,
        holdings: [],
        isIndexed: true,
        owner: ib.controller,
      };

      basketMap.set(ib.address.toLowerCase(), basketObj);
      if (ib.name) basketMap.set(ib.name.toLowerCase(), basketObj);
    });

    // 2. Supplement with local baskets only if not present in indexed state
    localBaskets.forEach((b) => {
      if (b.owner && b.owner.toLowerCase() === address.toLowerCase()) {
        const matchByAddr = basketMap.get(b.address.toLowerCase());
        const matchByName = b.name ? basketMap.get(b.name.toLowerCase()) : undefined;
        if (!matchByAddr && !matchByName) {
          basketMap.set(b.address.toLowerCase(), b);
        }
      }
    });

    const unique = Array.from(basketMap.values());
    const deduped: Basket[] = [];
    const seen = new Set<string>();
    for (const b of unique) {
      const key = b.address.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(b);
      }
    }
    return deduped;
  }, [isConnected, address, localBaskets, indexedBaskets]);

  const overviewHoldings = overviewResponse?.data?.holdings ?? [];
  const activeBaskets = candidateBaskets.map((basket): Basket => {
    const indexed = indexedBaskets.find((item) => item.address.toLowerCase() === basket.address.toLowerCase());
    const indexedValue = indexed?.totalNavUsdcMicro === null || indexed?.totalNavUsdcMicro === undefined
      ? basket.value
      : Number(indexed.totalNavUsdcMicro) / 1e6;
    return { ...basket, value: indexedValue, holdings: [] };
  });
  const livePositionsLoading = !overviewResponse && candidateBaskets.length > 0;
  const livePositionsUnavailable = false;

  // Executive Hero Metrics
  const totalNAV = useMemo(() => {
    const rawMicro = overviewResponse?.data?.totalNavUsdcMicro;
    return rawMicro !== null && rawMicro !== undefined
      ? Number(rawMicro) / 1e6
      : activeBaskets.reduce((sum, b) => sum + (b.value || 0), 0);
  }, [activeBaskets, overviewResponse]);

  const totalRealizedGains = useMemo(() => {
    return activeBaskets.reduce((sum, b) => sum + (b.realizedGains || 0), 0);
  }, [activeBaskets]);

  // Master Aggregated Holdings
  const aggregatedHoldings = useMemo(() => {
    const map = new Map<
      string,
      {
        symbol: string;
        name: string;
        color: string;
        currentPrice: number;
        totalUnits: number;
        totalValue: number;
        totalCostBasis: number;
        baskets: Set<string>;
      }
    >();

    overviewHoldings.forEach((h) => {
        const meta = supportedAssets.find((a) =>
          h.symbol !== null && a.symbol.toLowerCase() === h.symbol.toLowerCase() ||
          (a.address && h.assetAddress && a.address.toLowerCase() === h.assetAddress.toLowerCase())
        );
        const symbolKey = meta?.symbol || h.symbol || h.assetAddress.slice(0, 10);
        const qty = Number(formatUnits(BigInt(h.quantityBaseUnits), h.decimals));
        const val = h.valueUsdcMicro === null ? 0 : Number(h.valueUsdcMicro) / 1e6;
        const price = qty > 0 ? val / qty : 0;
        // Do not manufacture a gain from a market-return window when no
        // acquisition basis is available. A missing basis is neutral until
        // the indexer provides the position's average cost.
        const avgCost = h.averageCostUsdcMicroPerBaseUnit === null ? 0 : Number(h.averageCostUsdcMicroPerBaseUnit) / 1e6 * 10 ** h.decimals;
        const costBasis = avgCost > 0 ? qty * avgCost : val;

        const existing = map.get(symbolKey);
        if (existing) {
          existing.totalUnits += qty;
          existing.totalValue += val;
          existing.totalCostBasis += costBasis;
          existing.baskets.add("Portfolio");
        } else {
          map.set(symbolKey, {
            symbol: symbolKey,
            name: meta?.name || symbolKey,
            color: meta?.color || "#8aa4ff",
            currentPrice: price,
            totalUnits: qty,
            totalValue: val,
            totalCostBasis: costBasis,
            baskets: new Set(["Portfolio"]),
          });
        }
      });

    const result = Array.from(map.values()).map((item) => ({
      ...item,
      portfolioShare: totalNAV > 0 ? (item.totalValue / totalNAV) * 100 : 0,
      basketNames: Array.from(item.baskets),
    }));

    // Default sorted descending by Total USD Value
    return result.sort((a, b) => b.totalValue - a.totalValue);
  }, [overviewHoldings, totalNAV]);

  // Aggregate Unrealized P&L Calculation
  const { totalUnrealizedDollar, totalUnrealizedPercent } = useMemo(() => {
    const currentValue = aggregatedHoldings.reduce((sum, holding) => sum + holding.totalValue, 0);
    const costBasis = aggregatedHoldings.reduce((sum, holding) => sum + holding.totalCostBasis, 0);
    const totalUnrealizedGainUSD = currentValue - costBasis;
    const percent = costBasis > 0 ? (totalUnrealizedGainUSD / costBasis) * 100 : 0;
    return {
      totalUnrealizedDollar: totalUnrealizedGainUSD,
      totalUnrealizedPercent: percent,
    };
  }, [aggregatedHoldings]);

  // Sector Allocation Breakdown for Hollow Donut Chart
  const sectorAllocations = useMemo<SectorAllocation[]>(() => {
    const sectorValues: Record<string, { value: number; count: number; color: string }> = {};

    SECTOR_CATEGORIES.forEach((sector) => {
      sectorValues[sector] = { value: 0, count: 0, color: SECTOR_COLORS[sector] || "#8aa4ff" };
    });

    aggregatedHoldings.forEach((item) => {
      const sector = getAssetSector(item.symbol);
      if (sectorValues[sector]) {
        sectorValues[sector].value += item.totalValue;
        sectorValues[sector].count += 1;
      }
    });

    return SECTOR_CATEGORIES.map((sector) => {
      const val = sectorValues[sector].value;
      const share = totalNAV > 0 ? (val / totalNAV) * 100 : 0;
      return {
        sector,
        value: val,
        share,
        color: SECTOR_COLORS[sector] || "#8aa4ff",
        count: sectorValues[sector].count,
      };
    }).filter((item) => item.count > 0 || item.value > 0);
  }, [aggregatedHoldings, totalNAV]);

  // Performance Switcher Data (Top vs Lowest Performers)
  const { topGainers, lowestPerformers } = useMemo(() => {
    const evaluated = aggregatedHoldings.map((h) => ({
      symbol: h.symbol,
      name: h.name,
      color: h.color,
      change: getAssetChange(h.symbol, timeframe),
      value: h.totalValue,
    }));

    const sortedHighToLow = [...evaluated].sort((a, b) => b.change - a.change);
    const sortedLowToHigh = [...evaluated].sort((a, b) => a.change - b.change);

    const gainers = sortedHighToLow.filter((a) => a.change > 0).slice(0, 4);
    const topList = gainers.length > 0 ? gainers : sortedHighToLow.slice(0, 4);

    const losers = sortedLowToHigh.filter((a) => a.change < 0).slice(0, 4);
    const lowestList = losers.length > 0 ? losers : sortedLowToHigh.slice(0, 4);

    return {
      topGainers: topList,
      lowestPerformers: lowestList,
    };
  }, [aggregatedHoldings, timeframe]);

  // Combined Unified Activity Feed (Cross-basket recent activities)
  const recentActivities = useMemo(() => {
    if (!isConnected || !address) return [];
    const local = activeBaskets.flatMap((b) => getLocalActivity(b.address));
    const combined = [...local, ...indexedEvents];

    if (combined.length === 0) return [];

    // Remove duplicates by normalized transaction hash and event type.
    const uniqueMap = new Map<string, any>();
    combined.forEach((item) => {
      const key = item.txHash ? item.txHash.toLowerCase() : `${item.eventType}-${item.occurredAt}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, item);
      }
    });

    return Array.from(uniqueMap.values()).slice(0, 5);
  }, [isConnected, address, activeBaskets, indexedEvents]);

  return (
    <div className="app-page-frame">
      {/* Header */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "24px",
        }}
      >
        <div>
          <h1 className="page-title">
            Portfolio Overview
          </h1>
          <p className="page-description">
            Portfolio overview across active basket safes.
          </p>
        </div>
      </header>

      {/* 0. Asset & Portfolio Performance Interactive Graph */}
      <PortfolioPerformanceGraph
        points={valuationHistory?.data.points || []}
        isLoading={isValuationHistoryLoading}
        topGainers={topGainers}
        lowestPerformers={lowestPerformers}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
      />

      {/* 1. Portfolio Summary Hero Bar Chart Card */}
      <div
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--line)",
          borderRadius: "20px",
          padding: "24px 28px",
          marginBottom: "28px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        <div>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--ink)", margin: 0, letterSpacing: "-0.2px" }}>
            Portfolio Summary
          </h2>
          <p style={{ fontSize: "12px", color: "var(--ink-3)", margin: "2px 0 0 0" }}>
            Net asset value breakdown, unrealized returns, and locked-in profits across active safes.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Row 1: Total Portfolio NAV */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", alignItems: "center", gap: "20px" }}>
            <div
              style={{
                position: "relative",
                height: "40px",
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid var(--line)",
                borderRadius: "10px",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: "100%",
                  background: "linear-gradient(90deg, #10b981 0%, #34d399 100%)",
                  borderRadius: "9px",
                  transform: `scaleX(${totalNAV > 0 ? 1 : 0})`,
                  transformOrigin: "left center",
                  transition: "transform 0.4s ease",
                  opacity: 0.85,
                }}
              />
              <span
                style={{
                  position: "relative",
                  zIndex: 2,
                  paddingLeft: "16px",
                  fontSize: "14px",
                  fontWeight: 800,
                  fontFamily: "monospace",
                  color: "#ffffff",
                  textShadow: "0 1px 2px rgba(0, 0, 0, 0.6)",
                }}
              >
                ${formatCompactNumber(totalNAV)}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>
                Total Portfolio NAV
              </span>
              <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>Across active safes</span>
            </div>
          </div>

          {/* Row 2: Unrealized P&L */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", alignItems: "center", gap: "20px" }}>
            <div
              style={{
                position: "relative",
                height: "40px",
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid var(--line)",
                borderRadius: "10px",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: totalUnrealizedDollar < 0 ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: totalUnrealizedDollar >= 0 ? 0 : "auto",
                  right: totalUnrealizedDollar < 0 ? 0 : "auto",
                  width: "100%",
                  background: Math.abs(totalUnrealizedDollar) < 0.001
                    ? "rgba(255, 255, 255, 0.08)"
                    : totalUnrealizedDollar > 0
                    ? "linear-gradient(90deg, #10b981 0%, #34d399 100%)"
                    : "linear-gradient(270deg, #ef4444 0%, #f87171 100%)",
                  borderRadius: "9px",
                  transform: `scaleX(${Math.abs(totalUnrealizedDollar) < 0.001 ? 0 : Math.min(100, Math.max(12, Math.abs(totalUnrealizedPercent) * 5)) / 100})`,
                  transformOrigin: totalUnrealizedDollar < 0 ? "right center" : "left center",
                  transition: "transform 0.4s ease",
                  opacity: 0.85,
                }}
              />
              <span
                style={{
                  position: "relative",
                  zIndex: 2,
                  padding: totalUnrealizedDollar < 0 ? "0 16px 0 0" : "0 0 0 16px",
                  fontSize: "14px",
                  fontWeight: 800,
                  fontFamily: "monospace",
                  color: Math.abs(totalUnrealizedDollar) < 0.001 ? "var(--ink-3)" : "#ffffff",
                  textShadow: Math.abs(totalUnrealizedDollar) < 0.001 ? "none" : "0 1px 2px rgba(0, 0, 0, 0.6)",
                }}
              >
                {Math.abs(totalUnrealizedDollar) < 0.001
                  ? "+$0.00 (+0.00%)"
                  : `${totalUnrealizedDollar > 0 ? "+" : ""}$${formatCompactNumber(totalUnrealizedDollar)} (${totalUnrealizedPercent > 0 ? "+" : ""}${totalUnrealizedPercent.toFixed(2)}%)`
                }
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>
                Unrealized P&L
              </span>
              <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>Current value vs. cost basis</span>
            </div>
          </div>

          {/* Row 3: Realized P&L */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", alignItems: "center", gap: "20px" }}>
            <div
              style={{
                position: "relative",
                height: "40px",
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid var(--line)",
                borderRadius: "10px",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: "100%",
                  background: "linear-gradient(90deg, #10b981 0%, #34d399 100%)",
                  borderRadius: "9px",
                  transform: `scaleX(${totalRealizedGains > 0 ? 1 : 0})`,
                  transformOrigin: "left center",
                  transition: "transform 0.4s ease",
                  opacity: 0.85,
                }}
              />
              <span
                style={{
                  position: "relative",
                  zIndex: 2,
                  paddingLeft: "16px",
                  fontSize: "14px",
                  fontWeight: 800,
                  fontFamily: "monospace",
                  color: totalRealizedGains > 0 ? "#ffffff" : "var(--ink-3)",
                  textShadow: totalRealizedGains > 0 ? "0 1px 2px rgba(0, 0, 0, 0.6)" : "none",
                }}
              >
                {totalRealizedGains > 0 ? "+" : ""}${formatCompactNumber(totalRealizedGains)}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>
                Realized P&L
              </span>
              <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>Locked-in profits</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sector Allocation Donut Chart */}
      <div style={{ marginBottom: "28px" }}>
        <SectorDonutChart allocations={sectorAllocations} totalValue={totalNAV} />
      </div>

      {/* 5. Master Aggregated Holdings Table */}
      <section style={{ marginBottom: "32px" }}>
        <div
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--line)",
            borderRadius: "20px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "20px 24px",
              borderBottom: "1px solid var(--line)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--ink)", margin: 0, letterSpacing: "-0.2px" }}>
                Holdings
              </h2>
              <p style={{ fontSize: "12px", color: "var(--ink-3)", margin: "2px 0 0 0" }}>
                Aggregated asset positions across active basket safes.
              </p>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(0, 0.8fr) minmax(0, 1.1fr)",
              padding: "12px 24px",
              background: "rgba(255, 255, 255, 0.02)",
              borderBottom: "1px solid var(--line)",
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            <span>Asset</span>
            <span style={{ paddingLeft: "16px" }}>Share %</span>
            <span style={{ textAlign: "right" }}>Price / Units</span>
            <span style={{ textAlign: "right" }}>Total ($)</span>
            <span style={{ textAlign: "right" }}>Baskets</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            {aggregatedHoldings.length === 0 ? (
              <div style={{ padding: "36px 24px", textAlign: "center", color: "var(--ink-3)", fontSize: "13px" }}>
                {isWalletRestoring
                  ? "Restoring your wallet…"
                  : !isConnected
                  ? "No wallet connected. Connect your wallet to view active positions."
                  : livePositionsLoading
                  ? "Loading live onchain holdings…"
                  : livePositionsUnavailable
                  ? "Live holdings are unavailable right now."
                  : "No active basket holdings found for your connected wallet."}
              </div>
            ) : (
              aggregatedHoldings.map((holding) => {
                return (
                  <div
                    key={holding.symbol}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(0, 0.8fr) minmax(0, 1.1fr)",
                      alignItems: "center",
                      padding: "16px 24px",
                      borderBottom: "1px solid var(--line)",
                      fontSize: "14px",
                      transition: "background 0.15s ease",
                    }}
                  >
                    {/* Asset Symbol & Badge */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <StockLogo symbol={holding.symbol} size={24} roundedFull />
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <strong style={{ fontWeight: 700, color: "var(--ink)" }}>
                          {holding.symbol}
                        </strong>
                        <small style={{ color: "var(--ink-3)", fontSize: "11px" }}>
                          {holding.name}
                        </small>
                      </div>
                    </div>

                    {/* Portfolio Share (%) with Inline Allocation Progress Bar */}
                    <div style={{ paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", fontFamily: "monospace" }}>
                        {holding.portfolioShare.toFixed(1)}%
                      </span>
                      <div style={{ width: "100%", height: "5px", background: "rgba(255, 255, 255, 0.08)", borderRadius: "3px", overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${Math.min(100, Math.max(4, holding.portfolioShare))}%`,
                            height: "100%",
                            backgroundColor: holding.color,
                            borderRadius: "3px",
                          }}
                        />
                      </div>
                    </div>

                    {/* Current price and units held */}
                    <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: "2px", fontFamily: "monospace", minWidth: 0 }}>
                      <span style={{ color: "var(--ink)", fontWeight: 600 }}>
                        ${formatCompactNumber(holding.currentPrice)}
                      </span>
                      <small style={{ color: "var(--ink-3)", fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {holding.totalUnits.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} units
                      </small>
                    </div>

                    {/* Total Value ($) */}
                    <strong style={{ textAlign: "right", fontFamily: "monospace", color: "var(--ink)", fontSize: "14px" }}>
                      ${formatCompactNumber(holding.totalValue)}
                    </strong>

                    {/* Baskets list */}
                    <div style={{ minWidth: 0, textAlign: "right", display: "flex", justifyContent: "flex-end", gap: "4px", flexWrap: "wrap" }}>
                      {holding.basketNames.map((name) => (
                        <span
                          key={name}
                          style={{
                            fontSize: "11px",
                            color: "var(--ink-3)",
                            background: "rgba(255, 255, 255, 0.05)",
                            border: "1px solid var(--line)",
                            padding: "2px 8px",
                            borderRadius: "6px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
