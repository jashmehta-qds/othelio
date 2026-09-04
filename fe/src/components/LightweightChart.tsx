"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  IChartApi,
  Time,
  AreaSeries,
  CandlestickSeries,
  HistogramSeries,
} from "lightweight-charts";

export interface ChartDataPoint {
  time: string; // "YYYY-MM-DD"
  value?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}

interface LightweightChartProps {
  data: ChartDataPoint[];
  type?: "area" | "candlestick";
  height?: number;
  title?: string;
  subtitle?: string;
  showVolume?: boolean;
  color?: string;
  showTimeframeSelector?: boolean;
  onTimeframeChange?: (tf: string) => void;
  selectedTimeframe?: string;
  theme?: "dark" | "light";
}

export default function LightweightChart({
  data,
  type = "area",
  height = 320,
  title,
  subtitle,
  showVolume = false,
  color = "#d7ff46", // Acid green
  showTimeframeSelector = true,
  onTimeframeChange,
  selectedTimeframe = "1M",
  theme = "dark",
}: LightweightChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [activeTf, setActiveTf] = useState(selectedTimeframe);
  const [hoveredValue, setHoveredValue] = useState<number | null>(null);
  const [hoveredTime, setHoveredTime] = useState<string | null>(null);

  const handleTfClick = (tf: string) => {
    setActiveTf(tf);
    if (onTimeframeChange) {
      onTimeframeChange(tf);
    }
  };

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const container = chartContainerRef.current;

    const surface = theme === "dark" ? "#10110f" : "#f1f0e9";
    const muted = theme === "dark" ? "#96988f" : "#63665f";
    const line = theme === "dark" ? "rgba(43,44,40,.58)" : "rgba(212,211,204,.82)";
    const chart = createChart(container, {
      width: container.clientWidth,
      height: height,
      layout: {
        background: { type: ColorType.Solid, color: surface },
        textColor: muted,
        fontSize: 11,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      },
      grid: {
        vertLines: { color: line, style: 1 },
        horzLines: { color: line, style: 1 },
      },
      crosshair: {
        vertLine: {
          color: color,
          width: 1,
          style: 3,
          labelBackgroundColor: theme === "dark" ? "#1d1e1b" : "#e9e8e1",
        },
        horzLine: {
          color: color,
          width: 1,
          style: 3,
          labelBackgroundColor: theme === "dark" ? "#1d1e1b" : "#e9e8e1",
        },
      },
      rightPriceScale: {
        borderColor: line,
        scaleMargins: {
          top: 0.15,
          bottom: showVolume ? 0.25 : 0.1,
        },
      },
      timeScale: {
        borderColor: line,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: {
        mouseWheel: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    chartRef.current = chart;

    if (type === "area") {
      const areaSeries = chart.addSeries(AreaSeries, {
        topColor: color === "#d7ff46" ? "rgba(215, 255, 70, 0.35)" : "rgba(255, 255, 255, 0.3)",
        bottomColor: color === "#d7ff46" ? "rgba(215, 255, 70, 0.0)" : "rgba(0, 0, 0, 0)",
        lineColor: color,
        lineWidth: 2,
        priceFormat: {
          type: "price",
          precision: 2,
          minMove: 0.01,
        },
      });

      const formattedData = data.map((d) => ({
        time: d.time as Time,
        value: d.value ?? d.close ?? 0,
      }));
      areaSeries.setData(formattedData);
    } else {
      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#d7ff46",
        downColor: "#ff4e50",
        borderUpColor: "#d7ff46",
        borderDownColor: "#ff4e50",
        wickUpColor: "#d7ff46",
        wickDownColor: "#ff4e50",
      });

      const formattedData = data.map((d) => ({
        time: d.time as Time,
        open: d.open ?? d.value ?? 0,
        high: d.high ?? d.value ?? 0,
        low: d.low ?? d.value ?? 0,
        close: d.close ?? d.value ?? 0,
      }));
      candlestickSeries.setData(formattedData);
    }

    // Volume overlay if enabled
    if (showVolume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: "#292a27",
        priceFormat: {
          type: "volume",
        },
        priceScaleId: "",
      });

      chart.priceScale("").applyOptions({
        scaleMargins: {
          top: 0.75,
          bottom: 0,
        },
      });

      const volumeData = data.map((d) => ({
        time: d.time as Time,
        value: d.volume ?? Math.floor(Math.random() * 50000 + 10000),
        color: (d.close ?? d.value ?? 0) >= (d.open ?? d.value ?? 0) ? "rgba(215, 255, 70, 0.2)" : "rgba(255, 78, 80, 0.2)",
      }));
      volumeSeries.setData(volumeData);
    }

    // Crosshair hover listener
    chart.subscribeCrosshairMove((param) => {
      if (param.time) {
        setHoveredTime(param.time.toString());
        const dataPoint = param.seriesData.values().next().value;
        if (dataPoint) {
          if ("value" in dataPoint) {
            setHoveredValue(dataPoint.value as number);
          } else if ("close" in dataPoint) {
            setHoveredValue(dataPoint.close as number);
          }
        }
      } else {
        setHoveredTime(null);
        setHoveredValue(null);
      }
    });

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [data, type, height, color, showVolume, theme]);

  const latestVal = data && data.length > 0 ? (data[data.length - 1].close ?? data[data.length - 1].value ?? 0) : 0;
  const currentVal = hoveredValue !== null ? hoveredValue : latestVal;

  return (
    <div className="lw-chart-shell w-full flex flex-col relative group">
      {/* Header info */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          {title && (
            <div className="text-[11px] uppercase tracking-widest text-[var(--muted-ink)] font-mono">
              {title}
            </div>
          )}
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-2xl font-light text-[var(--ink)] tracking-tight font-mono">
              ${currentVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            {hoveredTime ? (
              <span className="text-xs text-[var(--muted-ink)] font-mono">{hoveredTime}</span>
            ) : (
              subtitle && <span className="text-xs text-[var(--accent)] font-mono">{subtitle}</span>
            )}
          </div>
        </div>

        {/* Timeframe Selector */}
        {showTimeframeSelector && (
          <div className="flex items-center gap-1 bg-[var(--panel)] p-1 border border-[var(--line)] rounded-lg">
            {["1D", "1W", "1M", "1Y", "ALL"].map((tf) => (
              <button
                key={tf}
                onClick={() => handleTfClick(tf)}
                className={`px-2 py-0.5 text-[10px] font-mono transition-colors rounded ${
                  activeTf === tf
                    ? "bg-[var(--accent)] text-[#10110f] font-semibold"
                    : "text-[var(--muted-ink)] hover:text-[var(--ink)]"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chart container */}
      <div ref={chartContainerRef} className="w-full relative" style={{ height }} />
    </div>
  );
}
