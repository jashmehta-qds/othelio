"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import StockLogo from "./StockLogo";
import LightweightChart, { ChartDataPoint } from "./LightweightChart";

export interface AssetDetailInfo {
  symbol: string;
  name: string;
  price: string;
  change: string;
  weight: number;
  contractAddress?: string;
  multiplier?: string;
  high24h?: string;
  low24h?: string;
  volume24h?: string;
  description?: string;
  historicalData?: ChartDataPoint[];
}

interface AssetDetailModalProps {
  asset: AssetDetailInfo | null;
  onClose: () => void;
}

// Generate realistic synthetic price data for fallback stock history
function generateSyntheticStockHistory(basePriceNum: number, points = 30): ChartDataPoint[] {
  const result: ChartDataPoint[] = [];
  const now = new Date();
  let currentPrice = basePriceNum * 0.92;

  for (let i = points; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const timeStr = d.toISOString().split("T")[0];

    const volatility = basePriceNum * 0.02;
    const change = (Math.random() - 0.47) * volatility;
    currentPrice = Math.max(currentPrice + change, basePriceNum * 0.5);

    const open = currentPrice - (Math.random() - 0.5) * volatility * 0.5;
    const high = Math.max(open, currentPrice) + Math.random() * volatility * 0.5;
    const low = Math.min(open, currentPrice) - Math.random() * volatility * 0.5;
    const close = currentPrice;
    const volume = Math.floor(Math.random() * 80000 + 20000);

    result.push({
      time: timeStr,
      value: Number(close.toFixed(2)),
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume,
    });
  }

  if (result.length > 0) {
    result[result.length - 1].value = basePriceNum;
    result[result.length - 1].close = basePriceNum;
  }

  return result;
}

export default function AssetDetailModal({ asset, onClose }: AssetDetailModalProps) {
  const [chartMode, setChartMode] = useState<"area" | "candlestick">("area");

  // Prevent background page body scroll when right panel drawer is open
  useEffect(() => {
    if (asset) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [asset]);

  const numericPrice = asset ? parseFloat(asset.price.replace(/[^0-9.]/g, "")) || 100 : 100;
  const isPositive = asset ? !asset.change.startsWith("-") : true;
  const chartData = asset?.historicalData || generateSyntheticStockHistory(numericPrice);

  const contractAddress = asset?.contractAddress || (asset ? `0x${asset.symbol.toLowerCase()}...b20base` : "");
  const multiplier = asset?.multiplier || "1.0000x";
  const high24h = asset?.high24h || `$${(numericPrice * 1.035).toFixed(2)}`;
  const low24h = asset?.low24h || `$${(numericPrice * 0.972).toFixed(2)}`;
  const volume24h = asset?.volume24h || "$4.2M";
  const description =
    asset?.description ||
    (asset
      ? `Coinbase tokenized representation of ${asset.name} (${asset.symbol.replace("c", "")}) on Base network. Backed 1:1 by underlying equity in regulated custody. B20 standard multiplier adjusts automatically for splits & dividends.`
      : "");

  return (
    <AnimatePresence>
      {asset && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs"
          />

          {/* Right Sliding Panel Drawer */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-xl bg-[#10110f] border-l border-[#292a27] text-[#eeeee7] shadow-2xl flex flex-col font-mono h-full overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-[#292a27] bg-[#161715] shrink-0">
              <div className="flex items-center gap-3">
                <StockLogo symbol={asset.symbol} size={36} roundedFull={true} />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-mono font-medium text-[#eeeee7] tracking-tight">{asset.symbol}</h2>
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-[#292a27] text-[#eeeee7]">
                      Base B20
                    </span>
                  </div>
                  <p className="text-xs text-[#898b84] font-mono">{asset.name}</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-lg font-mono font-normal text-[#eeeee7]">{asset.price}</div>
                  <div className={`text-xs font-mono ${isPositive ? "text-[#eeeee7]" : "text-[#898b84]"}`}>
                    {asset.change} 24h
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 text-[#898b84] hover:text-[#eeeee7] transition-colors font-mono text-base"
                  aria-label="Close detail panel"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Content body with clean single scroll */}
            <div className="p-5 overflow-y-auto space-y-6 flex-1 h-full">
              {/* Chart Controls & Lightweight Chart */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-[#898b84] font-mono">
                  <span className="uppercase tracking-wider">TradingView Live Price Feed</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px]">Type:</span>
                    <button
                      onClick={() => setChartMode("area")}
                      className={`px-2 py-0.5 text-[10px] font-mono ${
                        chartMode === "area" ? "bg-[#eeeee7] text-[#10110f] font-bold" : "bg-[#1b1c19] text-[#898b84]"
                      }`}
                    >
                      Area
                    </button>
                    <button
                      onClick={() => setChartMode("candlestick")}
                      className={`px-2 py-0.5 text-[10px] font-mono ${
                        chartMode === "candlestick" ? "bg-[#eeeee7] text-[#10110f] font-bold" : "bg-[#1b1c19] text-[#898b84]"
                      }`}
                    >
                      Candle
                    </button>
                  </div>
                </div>

                <LightweightChart
                  data={chartData}
                  type={chartMode}
                  height={280}
                  color="#eeeee7"
                  showVolume={true}
                  title={`${asset.symbol} / USD`}
                  subtitle={`${asset.change} (24h)`}
                />
              </div>

              {/* Key Metrics Grid */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#292a27]">
                <div className="bg-[#161715] p-3 border border-[#292a27]">
                  <span className="block text-[10px] uppercase tracking-wider text-[#898b84] font-mono">24h High</span>
                  <strong className="text-sm font-mono text-[#eeeee7] font-normal">{high24h}</strong>
                </div>
                <div className="bg-[#161715] p-3 border border-[#292a27]">
                  <span className="block text-[10px] uppercase tracking-wider text-[#898b84] font-mono">24h Low</span>
                  <strong className="text-sm font-mono text-[#eeeee7] font-normal">{low24h}</strong>
                </div>
                <div className="bg-[#161715] p-3 border border-[#292a27]">
                  <span className="block text-[10px] uppercase tracking-wider text-[#898b84] font-mono">24h Volume</span>
                  <strong className="text-sm font-mono text-[#eeeee7] font-normal">{volume24h}</strong>
                </div>
                <div className="bg-[#161715] p-3 border border-[#292a27]">
                  <span className="block text-[10px] uppercase tracking-wider text-[#898b84] font-mono">Index Weight</span>
                  <strong className="text-sm font-mono text-[#eeeee7] font-normal">{asset.weight}%</strong>
                </div>
              </div>

              {/* Base B20 & Oracle Details */}
              <div className="bg-[#161715] p-4 border border-[#292a27] space-y-2 text-xs font-mono">
                <div className="flex justify-between border-b border-[#292a27] pb-2">
                  <span className="text-[#898b84]">Base Token Standard:</span>
                  <span className="text-[#eeeee7]">B20 Precompile Native</span>
                </div>
                <div className="flex justify-between border-b border-[#292a27] pb-2">
                  <span className="text-[#898b84]">Corporate Multiplier:</span>
                  <span className="text-[#eeeee7]">{multiplier}</span>
                </div>
                <div className="flex justify-between border-b border-[#292a27] pb-2">
                  <span className="text-[#898b84]">Chainlink Oracle Feed:</span>
                  <span className="text-[#eeeee7]">Active</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#898b84]">Token Address (Base):</span>
                  <span className="text-[#898b84] truncate max-w-[200px]">{contractAddress}</span>
                </div>
              </div>

              {/* Description */}
              <p className="text-xs text-[#898b84] leading-relaxed font-sans">{description}</p>
            </div>

            {/* Footer actions */}
            <div className="p-4 border-t border-[#292a27] bg-[#161715] flex justify-end shrink-0">
              <button
                onClick={onClose}
                className="px-5 py-2 text-xs font-mono bg-[#eeeee7] text-[#10110f] font-bold hover:bg-white transition-colors"
              >
                Done
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
