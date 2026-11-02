"use client";

import { useState, useId } from "react";
import styles from "./RiskSplitComponents.module.css";

interface PayoffVisualizerProps {
  floorPrice: number;
  capPrice: number;
}

export function PayoffVisualizer({ floorPrice = 45, capPrice = 55 }: PayoffVisualizerProps) {
  const [simPrice, setSimPrice] = useState<number>(() => Math.max(1, (floorPrice + capPrice) / 2));
  const sliderId = useId();

  const F = floorPrice;
  const C = capPrice;
  const S = simPrice;

  // Exact math computation
  let protectedVal = 0;
  let upsideVal = 0;
  let protectedFrac = 0;
  let upsideFrac = 0;

  if (S === 0) {
    protectedVal = 0;
    upsideVal = 0;
  } else if (S < F) {
    protectedVal = S;
    upsideVal = 0;
    protectedFrac = 1;
    upsideFrac = 0;
  } else if (S < 2 * F) {
    protectedVal = F;
    upsideVal = S - F;
    protectedFrac = F / S;
    upsideFrac = 1 - protectedFrac;
  } else if (S < 2 * C) {
    protectedVal = S / 2;
    upsideVal = S / 2;
    protectedFrac = 0.5;
    upsideFrac = 0.5;
  } else {
    protectedVal = C;
    upsideVal = S - C;
    protectedFrac = C / S;
    upsideFrac = 1 - protectedFrac;
  }

  // Show both payoff transition points, including the 2 × cap boundary.
  const maxAxis = Math.max(1, Math.ceil(capPrice * 2.4), Math.ceil(simPrice * 1.1));
  const w = 480;
  const h = 220;
  const pad = 36;

  const toX = (val: number) => pad + (val / maxAxis) * (w - pad * 2);
  const toY = (val: number) => h - pad - (val / maxAxis) * (h - pad * 2);

  // Generate SVG path points
  const points = 70;
  let stockPath = `M ${toX(0)} ${toY(0)}`;
  let protPath = `M ${toX(0)} ${toY(0)}`;
  let upPath = `M ${toX(0)} ${toY(0)}`;

  for (let i = 1; i <= points; i++) {
    const p = (i / points) * maxAxis;
    const x = toX(p);
    stockPath += ` L ${x} ${toY(p)}`;

    let pVal = 0;
    let uVal = 0;
    if (p < F) {
      pVal = p;
      uVal = 0;
    } else if (p < 2 * F) {
      pVal = F;
      uVal = p - F;
    } else if (p < 2 * C) {
      pVal = p / 2;
      uVal = p / 2;
    } else {
      pVal = C;
      uVal = p - C;
    }

    protPath += ` L ${x} ${toY(pVal)}`;
    upPath += ` L ${x} ${toY(uVal)}`;
  }

  return (
    <div className={`ui-panel ${styles.card}`}>
      <div className={styles.cardHeader}>
        <div>
          <h3 className={styles.cardTitle}>Payoff Decomposition</h3>
          <p className={styles.cardSubtitle}>
            Continuous value conservation: Protected + Upside = Escrowed Stock
          </p>
        </div>
        <div className={styles.legend}>
          <span className={styles.legendStock}>Stock (1:1)</span>
          <span className={styles.legendProt}>Protected</span>
          <span className={styles.legendUp}>Upside</span>
        </div>
      </div>

      <div className={styles.chartContainer}>
        <svg viewBox={`0 0 ${w} ${h}`} className={styles.chartSvg}>
          {/* Grid lines */}
          <line x1={toX(0)} y1={toY(F)} x2={toX(maxAxis)} y2={toY(F)} stroke="#2a384c" strokeDasharray="3 3" />
          <line x1={toX(0)} y1={toY(C)} x2={toX(maxAxis)} y2={toY(C)} stroke="#2a384c" strokeDasharray="3 3" />
          <line x1={toX(F)} y1={toY(0)} x2={toX(F)} y2={toY(maxAxis)} stroke="#1e2d3e" strokeDasharray="2 2" />
          <line x1={toX(C)} y1={toY(0)} x2={toX(C)} y2={toY(maxAxis)} stroke="#1e2d3e" strokeDasharray="2 2" />

          {/* Curves */}
          <path d={stockPath} fill="none" stroke="#52637a" strokeWidth="1.5" strokeDasharray="4 4" />
          <path d={protPath} fill="none" stroke="#75e4c0" strokeWidth="2.5" />
          <path d={upPath} fill="none" stroke="#f6c879" strokeWidth="2.5" />

          {/* Current Sim Price Marker */}
          <line
            x1={toX(simPrice)}
            y1={toY(0)}
            x2={toX(simPrice)}
            y2={toY(maxAxis)}
            stroke="#ff5729"
            strokeWidth="1.5"
            strokeDasharray="2 2"
          />
          <circle cx={toX(simPrice)} cy={toY(protectedVal)} r="4.5" fill="#75e4c0" />
          <circle cx={toX(simPrice)} cy={toY(upsideVal)} r="4.5" fill="#f6c879" />

          {/* Labels */}
          <text x={toX(0)} y={toY(F) - 4} fill="#75e4c0" fontSize="10" fontFamily="monospace">
            Floor ${F}
          </text>
          <text x={toX(0)} y={toY(C) - 4} fill="#f6c879" fontSize="10" fontFamily="monospace">
            Cap ${C}
          </text>
        </svg>
      </div>

      {/* Interactive Range Scrubber */}
      <div className={styles.sliderSection}>
        <div className={styles.sliderHeader}>
          <label htmlFor={sliderId}>Simulate Settlement Price</label>
          <span className={styles.priceTag}>${simPrice.toFixed(2)}</span>
        </div>
        <input
          id={sliderId}
          type="range"
          min="0"
          max={maxAxis}
          step={Math.max(0.01, maxAxis / 140)}
          value={simPrice}
          onChange={(e) => setSimPrice(Number(e.target.value))}
          className={styles.rangeInput}
        />
      </div>

      {/* Payout Metric Grid */}
      <div className={styles.metricGrid}>
        <div className={styles.metricBox}>
          <span className={styles.metricLabel}>Stock Backing</span>
          <span className={styles.metricValue}>${simPrice.toFixed(2)}</span>
          <span className={styles.metricSub}>1.000 Stock</span>
        </div>
        <div className={`${styles.metricBox} ${styles.metricProt}`}>
          <span className={styles.metricLabel}>Protected Payout</span>
          <span className={styles.metricValue}>${protectedVal.toFixed(2)}</span>
          <span className={styles.metricSub}>{protectedFrac.toFixed(4)} Stock</span>
        </div>
        <div className={`${styles.metricBox} ${styles.metricUp}`}>
          <span className={styles.metricLabel}>Upside Payout</span>
          <span className={styles.metricValue}>${upsideVal.toFixed(2)}</span>
          <span className={styles.metricSub}>{upsideFrac.toFixed(4)} Stock</span>
        </div>
      </div>

      {/* Value Split Bar */}
      <div className={styles.splitBar}>
        <div
          className={styles.barProt}
          style={{ width: `${Math.max(0, Math.min(100, protectedFrac * 100))}%` }}
        />
        <div
          className={styles.barUp}
          style={{ width: `${Math.max(0, Math.min(100, upsideFrac * 100))}%` }}
        />
      </div>
    </div>
  );
}
