"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PortfolioValuationPoint, ValuationTimeframe } from "@/hooks/useBaskets";
import styles from "./OverviewDashboard.module.css";

export type Timeframe = ValuationTimeframe;
interface PortfolioPerformanceGraphProps {
  points: PortfolioValuationPoint[];
  isLoading: boolean;
  isError: boolean;
  isConnected: boolean;
  timeframe: Timeframe;
  onTimeframeChange: (timeframe: Timeframe) => void;
  onRetry: () => void;
}
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const signedMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", signDisplay: "exceptZero" });

export function PortfolioPerformanceGraph({ points, isLoading, isError, isConnected, timeframe, onTimeframeChange, onRetry }: PortfolioPerformanceGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [selection, setSelection] = useState<{ timeframe: Timeframe; timestamp: string } | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(180, entry.contentRect.width)));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const series = useMemo(() => points.filter((point) => Number.isFinite(point.totalNavUsdc) && Number.isFinite(Date.parse(point.observedAt)))
    .map((point) => ({ ...point, time: Date.parse(point.observedAt) })).sort((a, b) => a.time - b.time), [points]);
  const selectedIndex = selection?.timeframe === timeframe ? series.findIndex((point) => point.observedAt === selection.timestamp) : -1;
  const activeIndex = selectedIndex >= 0 ? selectedIndex : series.length - 1;
  const activePoint = series[activeIndex];
  const change = series.length > 1 && activePoint ? activePoint.totalNavUsdc - series[0].totalNavUsdc : null;
  const height = 230;
  const maxValue = series.length ? Math.max(...series.map((point) => point.totalNavUsdc)) : 1;
  const minValue = series.length ? Math.min(...series.map((point) => point.totalNavUsdc)) : 0;
  const padding = Math.max((maxValue - minValue) * .12, maxValue * .005, .01);
  const low = Math.max(0, minValue - padding);
  const high = maxValue + padding;
  const tickFormatter = new Intl.NumberFormat("en-US", { notation: high >= 1000 ? "compact" : "standard", maximumFractionDigits: high < 10 ? 3 : 2 });
  const ticks = [low, (low + high) / 2, high];
  const left = Math.max(46, Math.max(...ticks.map((tick) => tickFormatter.format(tick).length)) * 7 + 12);
  const right = 14, top = 20, bottom = 32;
  const firstTime = series[0]?.time ?? 0;
  const lastTime = series.at(-1)?.time ?? 1;
  const showTickTime = timeframe === "1D" || lastTime - firstTime < 48 * 60 * 60 * 1000;
  const x = (time: number) => lastTime === firstTime ? (left + width - right) / 2 : left + (time - firstTime) / (lastTime - firstTime) * (width - left - right);
  const y = (value: number) => top + (high - value) / (high - low) * (height - top - bottom);
  const path = series.map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time)} ${y(point.totalNavUsdc)}`).join(" ");
  const dateLabel = (date: string) => new Date(date).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const timeTicks = series.length > 1 ? [firstTime, (firstTime + lastTime) / 2, lastTime] : series.length === 1 ? [firstTime] : [];

  return <div>
    <div className={styles.chartHeading}><div><h2>Portfolio value over time</h2><p>{activePoint ? `${money.format(activePoint.totalNavUsdc)}${change !== null ? ` · ${signedMoney.format(change)} value change` : " · first indexed snapshot"}` : "Confirmed, indexed portfolio valuations"}</p></div><div className={styles.periods} aria-label="Chart period">{(["1D", "7D", "30D"] as Timeframe[]).map((period) => <button key={period} type="button" aria-pressed={timeframe === period} onClick={() => onTimeframeChange(period)}>{period}</button>)}</div></div>
    <div ref={containerRef} className={styles.chart}>
      {isLoading ? <div className={styles.chartEmpty}>Loading portfolio history…</div> : !isConnected ? <div className={styles.chartEmpty}><p>Connect your wallet to explore your portfolio’s history.</p></div> : isError && series.length === 0 ? <div className={styles.chartEmpty}><p>Portfolio history couldn’t be loaded.</p><button className={styles.textAction} onClick={onRetry}>Try again</button></div> : series.length === 0 ? <div className={styles.chartEmpty}><p>Your portfolio history will appear after a confirmed basket operation.</p><p>New deposits, rebalances, and withdrawals add indexed snapshots.</p></div> : <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Portfolio value history in USD, ${series.length} snapshots, latest value ${money.format(series.at(-1)!.totalNavUsdc)}`} onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const cursor = event.clientX - rect.left;
        const targetTime = firstTime + Math.max(0, Math.min(1, (cursor - left) / (width - left - right))) * (lastTime - firstTime);
        const nearest = series.reduce((best, point, index) => Math.abs(point.time - targetTime) < Math.abs(series[best].time - targetTime) ? index : best, 0);
        setSelection({ timeframe, timestamp: series[nearest].observedAt });
      }}>
        <title>Portfolio value history (USD)</title><desc>Value changes include deposits and withdrawals.</desc>
        <text x={left - 8} y={11} textAnchor="end">USD</text>
        {ticks.map((tick, index) => <g key={index}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeWidth="1" /><text x={left - 8} y={y(tick) + 4} textAnchor="end">{tickFormatter.format(tick)}</text></g>)}
        {series.length > 1 && <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        {activePoint && <g><line x1={x(activePoint.time)} x2={x(activePoint.time)} y1={top} y2={height - bottom} stroke="var(--muted-ink)" strokeWidth="1" strokeDasharray="3 3" /><circle cx={x(activePoint.time)} cy={y(activePoint.totalNavUsdc)} r="4" fill="var(--accent)" /></g>}
        {timeTicks.map((time, index) => <text key={index} x={x(time)} y={height - 8} textAnchor={series.length === 1 ? "middle" : index === 0 ? "start" : index === timeTicks.length - 1 ? "end" : "middle"}>{new Date(time).toLocaleString([], showTickTime ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" })}</text>)}
      </svg>}
    </div>
    {activePoint && !isLoading && <div className={styles.chartDetails}><time dateTime={activePoint.observedAt}>{dateLabel(activePoint.observedAt)}</time><span>{activePoint.basketCount} basket{activePoint.basketCount === 1 ? "" : "s"}</span>{isError && <span>Refresh unavailable · showing saved history</span>}</div>}
  </div>;
}
