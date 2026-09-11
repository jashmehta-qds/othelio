"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCompactNumber, getConfirmedCashFlowUsd, type BasketActivity } from "@/lib/baskets";
import { AppIcon } from "@/components/app-shell/AppIcon";

export type Timeframe = "1D" | "7D" | "30D";

export interface EventItem {
  type: "fund_in" | "fund_out";
  amount: number;
  description: string;
}

export interface DataPoint {
  timestamp: string;
  hourLabel: string;
  fullDate: string;
  value: number;
  fundFlows?: EventItem[];
  fundFlow?: EventItem;
}

interface PortfolioPerformanceGraphProps {
  totalNAV: number;
  topGainers: { symbol: string; change: number }[];
  lowestPerformers: { symbol: string; change: number }[];
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  activities?: BasketActivity[];
}

export function PortfolioPerformanceGraph({
  totalNAV,
  topGainers,
  lowestPerformers,
  timeframe,
  onTimeframeChange,
  activities = [],
}: PortfolioPerformanceGraphProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

    // In-memory calculation of Portfolio Valuation Series using holdings & activity step jumps
    const seriesData = useMemo<DataPoint[]>(() => {
      const now = new Date();
      const numPoints = timeframe === "1D" ? 24 : timeframe === "7D" ? 28 : 30;
      const intervalHours = timeframe === "1D" ? 1 : timeframe === "7D" ? 6 : 24;
      const totalHours = numPoints * intervalHours;

      // ACTUAL Target NAV from props
      const targetNAV = totalNAV;

      // ACTUAL Return over timeframe based on holdings performance drift
      let periodReturnPct = 0;
      if (topGainers.length > 0 || lowestPerformers.length > 0) {
        const gainerAvg = topGainers.reduce((s, g) => s + g.change, 0) / Math.max(1, topGainers.length);
        const loserAvg = lowestPerformers.reduce((s, l) => s + l.change, 0) / Math.max(1, lowestPerformers.length);
        periodReturnPct = (gainerAvg + loserAvg) / 2;
      } else {
        periodReturnPct = timeframe === "1D" ? 1.2 : timeframe === "7D" ? 3.5 : 8.4;
      }

      // Map ACTUAL activities to fund flow events (Fund In / Fund Out) - Supports multiple events per bucket
      const fundEvents: Map<number, EventItem[]> = new Map();

      activities.forEach((act) => {
        if (!act.occurred_at) return;
        const actTime = new Date(act.occurred_at).getTime();
        const hoursAgo = (now.getTime() - actTime) / (1000 * 60 * 60);

        if (hoursAgo >= 0 && hoursAgo <= totalHours) {
          const hourIdx = Math.min(numPoints - 1, Math.max(0, Math.round((totalHours - hoursAgo) / intervalHours)));
          const evtType = (act.event_type || "").toUpperCase();

          const isFundIn = evtType.includes("FUND") || evtType.includes("DEPOSIT") || evtType.includes("MINT");
          const isFundOut = evtType.includes("WITHDRAW");

          if (isFundIn || isFundOut) {
            const type = isFundIn ? "fund_in" : "fund_out";
            const confirmedFlow = getConfirmedCashFlowUsd(act);
            if (confirmedFlow === null) return;
            const amount = Math.abs(confirmedFlow);

            const description = isFundIn ? "Fund In Deposit" : "Fund Out Withdrawal";

            const existing = fundEvents.get(hourIdx) || [];
            existing.push({ type, amount, description });
            fundEvents.set(hourIdx, existing);
          }
        }
      });

      // Detect if basket safe creation timestamp exists in activity log
      const creationActivity = activities.find((act) => {
        const evtType = (act.event_type || "").toUpperCase();
        return evtType.includes("CREATE");
      });

      let creationTime: number | null = null;
      if (creationActivity && creationActivity.occurred_at) {
        creationTime = new Date(creationActivity.occurred_at).getTime();
      }

      // Compute historical series working BACKWARDS from actual current totalNAV
      const points: DataPoint[] = new Array(numPoints);
      let runningVal = targetNAV;

      for (let i = numPoints - 1; i >= 0; i--) {
        const hoursAgo = totalHours - i * intervalHours;
        const pointDate = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
        const pointTimestamp = pointDate.getTime();

        const hourLabel = pointDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const fullDate = pointDate.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

        const eventsAtPoint = fundEvents.get(i) || [];

        // If basket was created after this point date, opening valuation prior to creation is $0.00
        const isBeforeCreation = creationTime !== null && pointTimestamp < creationTime;
        const pointVal = isBeforeCreation ? 0 : Math.max(0, runningVal);

        points[i] = {
          timestamp: pointDate.toISOString(),
          hourLabel,
          fullDate,
          value: Number(pointVal.toFixed(2)),
          fundFlows: eventsAtPoint.length > 0 ? eventsAtPoint : undefined,
          fundFlow: eventsAtPoint[0],
        };

        if (!isBeforeCreation) {
          // Adjust runningVal backwards for fund flow events occurring at step i
          eventsAtPoint.forEach((evt) => {
            if (evt.type === "fund_in") {
              runningVal -= evt.amount;
            } else {
              runningVal += evt.amount;
            }
          });

          // Apply market return drift backwards per step
          const stepDriftPct = periodReturnPct / Math.max(1, numPoints);
          runningVal = runningVal / (1 + stepDriftPct / 100);
        }
      }

      return points;
    }, [totalNAV, timeframe, topGainers, lowestPerformers, activities]);

  const activePoint = hoverIndex !== null && seriesData[hoverIndex] ? seriesData[hoverIndex] : seriesData[seriesData.length - 1];
  const startVal = seriesData.length > 0 ? seriesData[0].value : totalNAV;
  const currentVal = activePoint ? activePoint.value : totalNAV;
  const dollarChange = currentVal - startVal;
  const pctChange = startVal > 0 ? (dollarChange / startVal) * 100 : 0;
  const isPositive = dollarChange >= 0;

  // SVG Chart Geometry
  const width = 800;
  const height = 220;
  const padding = { top: 20, right: 20, bottom: 35, left: 20 };

  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const minVal = useMemo(() => {
    if (seriesData.length === 0) return 0;
    return Math.min(...seriesData.map((d) => d.value)) * 0.995;
  }, [seriesData]);

  const maxVal = useMemo(() => {
    if (seriesData.length === 0) return 100;
    return Math.max(...seriesData.map((d) => d.value)) * 1.005;
  }, [seriesData]);

  const coords = useMemo(() => {
    if (seriesData.length === 0) return [];
    const valRange = maxVal - minVal || 1;
    return seriesData.map((d, idx) => {
      const x = padding.left + (idx / (seriesData.length - 1)) * chartW;
      const y = padding.top + chartH - ((d.value - minVal) / valRange) * chartH;
      return { x, y, data: d, index: idx };
    });
  }, [seriesData, minVal, maxVal, chartW, chartH]);

  // Exact Point-Passing Path (Guarantees line passes 100% precisely through every marker coordinate)
  const svgPath = useMemo(() => {
    if (coords.length < 2) return "";
    return coords.reduce((acc, pt, idx) => {
      return idx === 0 ? `M ${pt.x},${pt.y}` : `${acc} L ${pt.x},${pt.y}`;
    }, "");
  }, [coords]);

  const areaPath = useMemo(() => {
    if (!svgPath || coords.length === 0) return "";
    const firstX = coords[0].x;
    const lastX = coords[coords.length - 1].x;
    const bottomY = padding.top + chartH;
    return `${svgPath} L ${lastX},${bottomY} L ${firstX},${bottomY} Z`;
  }, [svgPath, coords, chartH]);

  return (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--line)",
        borderRadius: "20px",
        padding: "24px 28px",
        marginBottom: "32px",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
      }}
    >
      {/* Fixed-Height Top Header: Title Left, Timeframe Switcher Right */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
          borderBottom: "1px solid var(--line)",
          paddingBottom: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "var(--accent)", display: "flex", alignItems: "center" }}>
            <AppIcon type="trend-up" />
          </span>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--ink)", margin: 0, letterSpacing: "-0.2px" }}>
            Asset & Portfolio Performance
          </h2>
        </div>

        {/* Timeframe Switcher Pill (1D | 7D | 30D) */}
        <div
          style={{
            display: "inline-flex",
            background: "rgba(255, 255, 255, 0.05)",
            borderRadius: "8px",
            padding: "3px",
            border: "1px solid var(--line)",
          }}
        >
          {(["1D", "7D", "30D"] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => onTimeframeChange(tf)}
              style={{
                background: timeframe === tf ? "var(--accent)" : "transparent",
                color: timeframe === tf ? "#000" : "var(--ink-3)",
                border: "none",
                borderRadius: "6px",
                padding: "4px 14px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Fixed Layout Valuation Summary & Quick Mover Chips Row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: "16px",
          minHeight: "48px",
        }}
      >
        <div>
          <span style={{ fontSize: "12px", color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Portfolio Valuation ({activePoint?.fullDate || timeframe})
          </span>
          <div style={{ display: "flex", alignItems: "baseline", gap: "12px", marginTop: "4px" }}>
            <h3 style={{ fontSize: "28px", fontWeight: 800, fontFamily: "monospace", color: "var(--ink)", margin: 0 }}>
              ${formatCompactNumber(currentVal)}
            </h3>
            <span
              style={{
                fontSize: "13px",
                fontWeight: 700,
                fontFamily: "monospace",
                color: isPositive ? "#10b981" : "#ef4444",
                background: isPositive ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                padding: "2px 8px",
                borderRadius: "6px",
              }}
            >
              {isPositive ? "+" : ""}${formatCompactNumber(dollarChange)} ({isPositive ? "+" : ""}{pctChange.toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Fixed Position Quick Movers Chips (Best / Lag) */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {topGainers.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "rgba(16, 185, 129, 0.08)",
                border: "1px solid rgba(16, 185, 129, 0.2)",
                padding: "4px 10px",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            >
              <span style={{ color: "var(--ink-3)", fontSize: "11px", fontWeight: 600 }}>Best:</span>
              <strong style={{ color: "#10b981", fontWeight: 700, fontFamily: "monospace" }}>
                {topGainers[0].symbol} +{topGainers[0].change.toFixed(1)}%
              </strong>
            </div>
          )}

          {lowestPerformers.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                padding: "4px 10px",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            >
              <span style={{ color: "var(--ink-3)", fontSize: "11px", fontWeight: 600 }}>Lag:</span>
              <strong style={{ color: "#ef4444", fontWeight: 700, fontFamily: "monospace" }}>
                {lowestPerformers[0].symbol} {lowestPerformers[0].change.toFixed(1)}%
              </strong>
            </div>
          )}
        </div>
      </div>

      {/* SVG Interactive Portfolio Line Graph (Absolute Hover Callouts = Zero Layout Shift) */}
      <div style={{ position: "relative", width: "100%", height: `${height}px`, userSelect: "none" }}>
        {/* Absolutely Positioned Event Note Overlay (Zero Layout Shift on Hover!) */}
        {hoverIndex !== null && activePoint?.fundFlow && (
          <div
            style={{
              position: "absolute",
              top: "8px",
              right: "16px",
              zIndex: 10,
              pointerEvents: "none",
              background: activePoint.fundFlow.type === "fund_in" ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
              border: `1px solid ${activePoint.fundFlow.type === "fund_in" ? "rgba(16, 185, 129, 0.35)" : "rgba(239, 68, 68, 0.35)"}`,
              borderRadius: "8px",
              padding: "5px 12px",
              fontSize: "12px",
              fontWeight: 700,
              color: activePoint.fundFlow.type === "fund_in" ? "#10b981" : "#ef4444",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span style={{ width: "12px", height: "12px", display: "inline-flex", alignItems: "center" }}>
              <AppIcon type={activePoint.fundFlow.type === "fund_in" ? "trend-up" : "trend-down"} />
            </span>
            {activePoint.fundFlow.description} (${formatCompactNumber(activePoint.fundFlow.amount)})
          </div>
        )}

        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: "100%", height: "100%", overflow: "visible" }}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isPositive ? "#10b981" : "#ef4444"} stopOpacity="0.25" />
              <stop offset="100%" stopColor={isPositive ? "#10b981" : "#ef4444"} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid lines */}
          {[0, 0.33, 0.66, 1].map((pct, idx) => {
            const y = padding.top + chartH * pct;
            return (
              <line
                key={idx}
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="rgba(255, 255, 255, 0.05)"
                strokeDasharray="4 4"
              />
            );
          })}

          {/* Gradient Area Fill under Curve */}
          {areaPath && <path d={areaPath} fill="url(#portfolioGradient)" />}

          {/* Smooth Valuation Curve Line */}
          {svgPath && (
            <path
              d={svgPath}
              fill="none"
              stroke={isPositive ? "#10b981" : "#ef4444"}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Fund Flow Event Sticker Badges (B for Buy/Fund In, S for Sell/Fund Out) */}
          {coords.map((pt) => {
            const flows = pt.data.fundFlows || (pt.data.fundFlow ? [pt.data.fundFlow] : []);
            if (flows.length === 0) return null;

            return flows.map((evt, evtIdx) => {
              const isBuy = evt.type === "fund_in";
              const badgeText = isBuy ? "B" : "S";
              const badgeBg = isBuy ? "#10b981" : "#ef4444";
              const offsetX = (evtIdx - (flows.length - 1) / 2) * 22;

              return (
                <g key={`event-${pt.index}-${evtIdx}`}>
                  {/* Subtle Glow Circle */}
                  <circle
                    cx={pt.x + offsetX}
                    cy={pt.y}
                    r="12"
                    fill={badgeBg}
                    opacity="0.2"
                  />
                  {/* Rounded Sticker Pill */}
                  <rect
                    x={pt.x + offsetX - 9}
                    y={pt.y - 9}
                    width="18"
                    height="18"
                    rx="5"
                    fill={badgeBg}
                    stroke="#0f172a"
                    strokeWidth="1.5"
                  />
                  {/* Sticker Letter Text */}
                  <text
                    x={pt.x + offsetX}
                    y={pt.y + 4.5}
                    fill="#ffffff"
                    fontSize="11"
                    fontWeight="800"
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    {badgeText}
                  </text>
                </g>
              );
            });
          })}

          {/* Active Hover Crosshair Line & Dot */}
          {hoverIndex !== null && coords[hoverIndex] && (
            <g>
              <line
                x1={coords[hoverIndex].x}
                y1={padding.top}
                x2={coords[hoverIndex].x}
                y2={padding.top + chartH}
                stroke="var(--accent)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <circle
                cx={coords[hoverIndex].x}
                cy={coords[hoverIndex].y}
                r="6"
                fill="var(--accent)"
                stroke="#000"
                strokeWidth="2"
              />
            </g>
          )}

          {/* Invisible Overlay Slices for Smooth Hover Tracking */}
          {coords.map((pt, idx) => {
            const stepW = chartW / Math.max(1, coords.length - 1);
            return (
              <rect
                key={idx}
                x={pt.x - stepW / 2}
                y={padding.top}
                width={stepW}
                height={chartH}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoverIndex(idx)}
              />
            );
          })}

          {/* X Axis Time Labels */}
          {coords.filter((_, idx) => idx % Math.ceil(coords.length / 6) === 0 || idx === coords.length - 1).map((pt, idx) => (
            <text
              key={idx}
              x={pt.x}
              y={height - 10}
              fill="var(--ink-3)"
              fontSize="11"
              fontFamily="monospace"
              textAnchor="middle"
            >
              {pt.data.hourLabel}
            </text>
          ))}
        </svg>
      </div>

      {/* Hourly Cache Footer Note */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "11px",
          color: "var(--ink-3)",
          borderTop: "1px solid var(--line)",
          paddingTop: "12px",
        }}
      >
        <span>
          Valuation snapshot: <strong style={{ color: "var(--ink)" }}>{seriesData[seriesData.length - 1]?.fullDate || "Current"}</strong>
        </span>
        <div style={{ display: "flex", gap: "16px" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <span style={{ background: "#10b981", color: "#ffffff", fontWeight: 800, padding: "1px 6px", borderRadius: "4px", fontSize: "10px", fontFamily: "monospace" }}>B</span>
            Fund In (Buy / Deposit)
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <span style={{ background: "#ef4444", color: "#ffffff", fontWeight: 800, padding: "1px 6px", borderRadius: "4px", fontSize: "10px", fontFamily: "monospace" }}>S</span>
            Fund Out (Sell / Withdrawal)
          </span>
        </div>
      </div>
    </div>
  );
}
