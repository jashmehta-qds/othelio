"use client";

import { useMemo, useState } from "react";
import { formatCompactNumber } from "@/lib/baskets";
import type { PortfolioValuationPoint, ValuationTimeframe } from "@/hooks/useBaskets";
import { AppIcon } from "@/components/app-shell/AppIcon";

export type Timeframe = ValuationTimeframe;

interface DataPoint {
  timestamp: string;
  hourLabel: string;
  fullDate: string;
  value: number;
  blockNumber: string;
  basketCount: number;
}

interface PortfolioPerformanceGraphProps {
  points: PortfolioValuationPoint[];
  isLoading: boolean;
  topGainers: { symbol: string; change: number }[];
  lowestPerformers: { symbol: string; change: number }[];
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
}

export function PortfolioPerformanceGraph({
  points,
  isLoading,
  topGainers,
  lowestPerformers,
  timeframe,
  onTimeframeChange,
}: PortfolioPerformanceGraphProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const seriesData = useMemo<DataPoint[]>(() => points
    .filter((point) => Number.isFinite(point.totalNavUsdc))
    .map((point) => {
      const date = new Date(point.observedAt);
      const timeLabel = timeframe === "1D"
        ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : date.toLocaleDateString([], { month: "short", day: "numeric" });
      return {
        timestamp: point.observedAt,
        hourLabel: timeLabel,
        fullDate: date.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        value: point.totalNavUsdc,
        blockNumber: point.blockNumber,
        basketCount: point.basketCount,
      };
    }), [points, timeframe]);

  const activePoint = hoverIndex !== null && seriesData[hoverIndex]
    ? seriesData[hoverIndex]
    : seriesData.at(-1);
  const startVal = seriesData[0]?.value;
  const currentVal = activePoint?.value;
  const dollarChange = startVal !== undefined && currentVal !== undefined ? currentVal - startVal : null;
  const pctChange = dollarChange !== null && startVal > 0 ? (dollarChange / startVal) * 100 : null;
  const isPositive = (dollarChange ?? 0) >= 0;
  const observedCoverage = useMemo(() => {
    if (seriesData.length < 2) return seriesData.length === 1 ? "1 observed snapshot" : null;
    const milliseconds = new Date(seriesData.at(-1)!.timestamp).getTime() - new Date(seriesData[0].timestamp).getTime();
    const hours = Math.max(1, Math.round(milliseconds / (60 * 60 * 1000)));
    return `${seriesData.length} observed snapshots over ${hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`}`;
  }, [seriesData]);

  const width = 800;
  const height = 220;
  const padding = { top: 20, right: 20, bottom: 35, left: 20 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const minVal = seriesData.length ? Math.min(...seriesData.map((d) => d.value)) * 0.995 : 0;
  const maxVal = seriesData.length ? Math.max(...seriesData.map((d) => d.value)) * 1.005 : 1;
  const coords = useMemo(() => {
    if (!seriesData.length) return [];
    const valRange = maxVal - minVal || 1;
    return seriesData.map((data, index) => ({
      x: padding.left + (seriesData.length === 1 ? chartW / 2 : (index / (seriesData.length - 1)) * chartW),
      y: padding.top + chartH - ((data.value - minVal) / valRange) * chartH,
      data,
      index,
    }));
  }, [seriesData, minVal, maxVal, chartW, chartH]);
  const svgPath = useMemo(() => coords.length < 2 ? "" : coords.reduce((path, point, index) => (
    index === 0 ? `M ${point.x},${point.y}` : `${path} L ${point.x},${point.y}`
  ), ""), [coords]);
  const areaPath = svgPath && coords.length
    ? `${svgPath} L ${coords.at(-1)!.x},${padding.top + chartH} L ${coords[0].x},${padding.top + chartH} Z`
    : "";

  return (
    <div style={{ background: "var(--surface-1)", border: "1px solid var(--line)", borderRadius: "20px", padding: "24px 28px", marginBottom: "32px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", borderBottom: "1px solid var(--line)", paddingBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "var(--accent)", display: "flex", alignItems: "center" }}><AppIcon type="trend-up" /></span>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--ink)", margin: 0, letterSpacing: "-0.2px" }}>Portfolio valuation history</h2>
        </div>
        <div style={{ display: "inline-flex", background: "rgba(255, 255, 255, 0.05)", borderRadius: "8px", padding: "3px", border: "1px solid var(--line)" }}>
          {(["1D", "7D", "30D"] as Timeframe[]).map((tf) => <button key={tf} onClick={() => onTimeframeChange(tf)} style={{ background: timeframe === tf ? "var(--accent)" : "transparent", color: timeframe === tf ? "#000" : "var(--ink-3)", border: "none", borderRadius: "6px", padding: "4px 14px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>{tf}</button>)}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "16px", minHeight: "48px" }}>
        <div>
          <span style={{ fontSize: "12px", color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            {activePoint ? <>Portfolio valuation (<strong style={{ color: "#ffffff" }}>{activePoint.fullDate}</strong>)</> : "Portfolio valuation"}
          </span>
          <div style={{ display: "flex", alignItems: "baseline", gap: "12px", marginTop: "4px" }}>
            <h3 style={{ fontSize: "28px", fontWeight: 800, fontFamily: "monospace", color: "var(--ink)", margin: 0 }}>
              {currentVal === undefined ? "—" : `$${formatCompactNumber(currentVal)}`}
            </h3>
            {dollarChange !== null && pctChange !== null && <span style={{ fontSize: "13px", fontWeight: 700, fontFamily: "monospace", color: isPositive ? "#10b981" : "#ef4444", background: isPositive ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)", padding: "2px 8px", borderRadius: "6px" }}>
              {isPositive ? "+" : ""}$${formatCompactNumber(dollarChange)} ({isPositive ? "+" : ""}{pctChange.toFixed(2)}%)
            </span>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {topGainers[0] && <div style={{ background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.2)", padding: "4px 10px", borderRadius: "8px", fontSize: "12px" }}><span style={{ color: "var(--ink-3)", fontSize: "11px", fontWeight: 600 }}>Best: </span><strong style={{ color: "#10b981", fontFamily: "monospace" }}>{topGainers[0].symbol} +{topGainers[0].change.toFixed(1)}%</strong></div>}
          {lowestPerformers[0] && <div style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.2)", padding: "4px 10px", borderRadius: "8px", fontSize: "12px" }}><span style={{ color: "var(--ink-3)", fontSize: "11px", fontWeight: 600 }}>Lag: </span><strong style={{ color: "#ef4444", fontFamily: "monospace" }}>{lowestPerformers[0].symbol} {lowestPerformers[0].change.toFixed(1)}%</strong></div>}
        </div>
      </div>

      <div style={{ position: "relative", width: "100%", height: `${height}px`, userSelect: "none" }}>
        {isLoading ? <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--ink-3)", fontSize: "13px" }}>Loading indexed valuations…</div> : seriesData.length === 0 ? <div style={{ height: "100%", display: "grid", placeItems: "center", textAlign: "center", color: "var(--ink-3)", fontSize: "13px", lineHeight: 1.5 }}>No canonical valuation history yet.<br />It appears after a confirmed, indexed portfolio operation.</div> : <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "100%", overflow: "visible" }} onMouseLeave={() => setHoverIndex(null)}>
          <defs><linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={isPositive ? "#10b981" : "#ef4444"} stopOpacity="0.25" /><stop offset="100%" stopColor={isPositive ? "#10b981" : "#ef4444"} stopOpacity="0" /></linearGradient></defs>
          {[0, 0.33, 0.66, 1].map((pct) => <line key={pct} x1={padding.left} y1={padding.top + chartH * pct} x2={width - padding.right} y2={padding.top + chartH * pct} stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="4 4" />)}
          {areaPath && <path d={areaPath} fill="url(#portfolioGradient)" />}
          {svgPath && <path d={svgPath} fill="none" stroke={isPositive ? "#10b981" : "#ef4444"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
          {coords.length === 1 && <circle cx={coords[0].x} cy={coords[0].y} r="4" fill="var(--accent)" />}
          {hoverIndex !== null && coords[hoverIndex] && <g><line x1={coords[hoverIndex].x} y1={padding.top} x2={coords[hoverIndex].x} y2={padding.top + chartH} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" /><circle cx={coords[hoverIndex].x} cy={coords[hoverIndex].y} r="6" fill="var(--accent)" stroke="#000" strokeWidth="2" /></g>}
          {coords.map((point, index) => { const step = chartW / Math.max(1, coords.length - 1); return <rect key={point.data.timestamp} x={point.x - step / 2} y={padding.top} width={step} height={chartH} fill="transparent" style={{ cursor: "pointer" }} onMouseEnter={() => setHoverIndex(index)} />; })}
          {coords.filter((_, index) => index % Math.ceil(coords.length / 6) === 0 || index === coords.length - 1).map((point) => <text key={point.data.timestamp} x={point.x} y={height - 10} fill="#ffffff" fontSize="11" fontWeight="600" fontFamily="monospace" textAnchor="middle">{point.data.hourLabel}</text>)}
        </svg>}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "var(--ink-3)", borderTop: "1px solid var(--line)", paddingTop: "12px" }}>
        <span>Source: <strong style={{ color: "var(--ink)" }}>indexed end-of-block oracle snapshots</strong>{observedCoverage ? ` · ${observedCoverage}` : ""}</span>
        {activePoint && <span>As of <strong style={{ color: "#ffffff" }}>{activePoint.fullDate}</strong> · {activePoint.basketCount} basket{activePoint.basketCount === 1 ? "" : "s"}</span>}
      </div>
    </div>
  );
}
