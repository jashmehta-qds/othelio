"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount, useChainId } from "wagmi";
import { useAllActivity, useBasketsList, usePortfolioValuationHistory } from "@/hooks/useBaskets";
import { canonicalSpotNav } from "@/lib/valuation";
import {
  assetPrices,
  defaultDemoBaskets,
  formatAddress,
  formatCompactNumber,
  formatEventLabel,
  formatEventMetadata,
  getAssetChange,
  getAssetSector,
  getBasket,
  getCreatedBaskets,
  getLocalActivity,
  isUserFacingActivity,
  SECTOR_COLORS,
  supportedAssets,
  type Basket,
  type BasketActivity,
  type Holding,
} from "@/lib/baskets";
import { SectorDonutChart, type SectorAllocation } from "./SectorDonutChart";
import { PortfolioPerformanceGraph } from "./PortfolioPerformanceGraph";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { useWalletRestoring } from "@/hooks/useWalletRestoring";

type Timeframe = "1D" | "7D" | "30D";
type IndexedPosition = {
  symbol?: string;
  asset_address?: string;
  avg_cost_usdc?: number | string | null;
};

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

  // Fetch indexed baskets from backend API
  const { data: apiResponse } = useBasketsList(chainId, isConnected ? address : undefined);
  const indexedBaskets = apiResponse?.data || [];
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
  const activeBaskets = useMemo<Basket[]>(() => {
    if (!isConnected || !address) return [];

    const basketMap = new Map<string, Basket>();

    // 1. Process indexed baskets first (authoritative on-chain / backend state)
    indexedBaskets.forEach((ib) => {
      if (ib.controller && ib.controller.toLowerCase() !== address.toLowerCase()) {
        return;
      }
      const basketVal = canonicalSpotNav((ib as any).snapshot) ?? 0;

      const mappedHoldings: Holding[] = (ib as any).assets && Array.isArray((ib as any).assets) && (ib as any).assets.length > 0
        ? (ib as any).assets.map((ast: any) => {
            const rawAddr = ast.asset_address ? String(ast.asset_address).trim() : "";
            const knownMeta = supportedAssets.find((sa) =>
              sa.symbol.toLowerCase() === rawAddr.toLowerCase() ||
              (sa.address && sa.address.toLowerCase() === rawAddr.toLowerCase())
            );
            const symbolKey = knownMeta?.symbol || (rawAddr.startsWith("0x") ? `${rawAddr.slice(0, 6)}…` : rawAddr || "USDC");
            const targetWeight = (ast.target_weight_bps || 0) / 100;
            const val = (basketVal * targetWeight) / 100;
            const price = assetPrices[symbolKey] || 100;
            const quantity = price > 0 ? Number((val / price).toFixed(4)) : 0;
            return {
              symbol: symbolKey,
              name: knownMeta?.name || symbolKey,
              target: targetWeight,
              current: targetWeight,
              quantity,
              value: val,
              color: knownMeta?.color || "#8aa4ff",
              address: knownMeta?.address || rawAddr,
            };
          })
        : [];

      const basketObj: Basket = {
        name: ib.name,
        symbol: ib.symbol || "OTH",
        value: basketVal,
        change: 0.0,
        updated: ib.created_at ? new Date(ib.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Recently",
        address: ib.address,
        holdings: mappedHoldings,
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

  // Executive Hero Metrics
  const totalNAV = useMemo(() => {
    return activeBaskets.reduce((sum, b) => sum + (b.value || 0), 0);
  }, [activeBaskets]);

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

    activeBaskets.forEach((basket) => {
      const holdings = basket.holdings && basket.holdings.length > 0
        ? basket.holdings
        : [];

      holdings.forEach((h) => {
        const meta = supportedAssets.find((a) =>
          a.symbol.toLowerCase() === h.symbol.toLowerCase() ||
          (a.address && h.address && a.address.toLowerCase() === h.address.toLowerCase()) ||
          (a.address && a.address.toLowerCase() === h.symbol.toLowerCase())
        );
        const symbolKey = meta?.symbol || h.symbol;
        const price = assetPrices[symbolKey] || 100;
        const val = h.value || (h.quantity * price);
        const qty = h.quantity || (price > 0 ? val / price : 0);
        // Do not manufacture a gain from a market-return window when no
        // acquisition basis is available. A missing basis is neutral until
        // the indexer provides the position's average cost.
        const costBasis = h.avgCost && h.avgCost > 0 ? qty * h.avgCost : val;

        const existing = map.get(symbolKey);
        if (existing) {
          existing.totalUnits += qty;
          existing.totalValue += val;
          existing.totalCostBasis += costBasis;
          existing.baskets.add(basket.symbol);
        } else {
          map.set(symbolKey, {
            symbol: symbolKey,
            name: meta?.name || h.name || symbolKey,
            color: meta?.color || h.color || "#8aa4ff",
            currentPrice: price,
            totalUnits: qty,
            totalValue: val,
            totalCostBasis: costBasis,
            baskets: new Set([basket.symbol]),
          });
        }
      });
    });

    const result = Array.from(map.values()).map((item) => ({
      ...item,
      portfolioShare: totalNAV > 0 ? (item.totalValue / totalNAV) * 100 : 0,
      basketNames: Array.from(item.baskets),
    }));

    // Default sorted descending by Total USD Value
    return result.sort((a, b) => b.totalValue - a.totalValue);
  }, [activeBaskets, totalNAV]);

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

    // Remove duplicates by tx_hash
    const uniqueMap = new Map<string, any>();
    combined.forEach((item) => {
      const key = item.tx_hash ? item.tx_hash.toLowerCase() : `${item.event_type}-${item.occurred_at}`;
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
                      <span
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          backgroundColor: holding.color,
                          flexShrink: 0,
                        }}
                      />
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
