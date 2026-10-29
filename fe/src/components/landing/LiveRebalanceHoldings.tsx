"use client";

import { useEffect, useRef, useState } from "react";
import { OthelioLogo } from "@/components/brand/OthelioLogo";
import StockLogo from "@/components/StockLogo";
import styles from "./LiveRebalanceHoldings.module.css";

interface HoldingItem {
  symbol: string;
  name: string;
  targetWeight: number;
  driftWeight: number;
  color: string;
}

const HOLDINGS: HoldingItem[] = [
  { symbol: "NVDA", name: "NVIDIA Corp", targetWeight: 40, driftWeight: 47, color: "#76b900" },
  { symbol: "AAPL", name: "Apple Inc", targetWeight: 30, driftWeight: 26, color: "#a2aaad" },
  { symbol: "MSFT", name: "Microsoft Corp", targetWeight: 20, driftWeight: 18, color: "#00a4ef" },
  { symbol: "USDC", name: "USD Coin", targetWeight: 10, driftWeight: 9, color: "#2775ca" },
];

type RebalancePhase = "balanced" | "drift" | "rebalancing" | "settled";

function IconBolt() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12" aria-hidden="true">
      <path d="M9.2 1.5L2.8 8.5h4.4L6 14.5l6.8-7.2H8.4l.8-5.8z" />
    </svg>
  );
}

function IconSync() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="12"
      height="12"
      aria-hidden="true"
    >
      <path d="M14 7.5a6 6 0 1 1-1.76-4.24L14 5" />
      <path d="M14 1.5V5h-3.5" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="12"
      height="12"
      aria-hidden="true"
    >
      <path d="M3 8.5l3.5 3.5L13 4.5" />
    </svg>
  );
}

export default function LiveRebalanceHoldings() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasEntered, setHasEntered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [phase, setPhase] = useState<RebalancePhase>("balanced");
  const [weights, setWeights] = useState<number[]>([40, 30, 20, 10]);

  // 1. IntersectionObserver: triggers entrance once and pauses story loop when off-screen
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          setHasEntered(true);
          setIsVisible(true);
        } else {
          setIsVisible(false);
        }
      },
      { threshold: 0.25 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 2. The Living Story Loop
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion || !isVisible || !hasEntered) return;

    let timeoutId: NodeJS.Timeout;

    const runStoryCycle = () => {
      // Phase 1: Equilibrium Baseline (holds for 2.8s)
      setPhase("balanced");
      setWeights([40, 30, 20, 10]);

      timeoutId = setTimeout(() => {
        // Phase 2: Market Drift Event (NVDA rallies, weights drift)
        setPhase("drift");
        setWeights([47, 26, 18, 9]);

        timeoutId = setTimeout(() => {
          // Phase 3: Auto-Rebalance Execution (glides back along --io curves)
          setPhase("rebalancing");
          setWeights([40, 30, 20, 10]);

          timeoutId = setTimeout(() => {
            // Phase 4: Onchain Settlement
            setPhase("settled");

            timeoutId = setTimeout(() => {
              // Smooth repeat
              runStoryCycle();
            }, 2600);
          }, 1100);
        }, 3400);
      }, 3000);
    };

    runStoryCycle();

    return () => clearTimeout(timeoutId);
  }, [isVisible, hasEntered]);

  return (
    <div
      ref={containerRef}
      className={`${styles.holdings} ${hasEntered ? styles.in : ""}`}
      aria-label="Inside a basket composition and live rebalancing demonstration"
    >
      {/* Header with polished status pill */}
      <div className={styles.holdingsHeader}>
        <div className={styles.holdingsMark} aria-hidden="true">
          <OthelioLogo size={30} />
        </div>
        <div className={styles.headerTitles}>
          <span>INSIDE A BASKET</span>
          <strong>Illustrative composition</strong>
        </div>

        {/* Polished Status Badge with SVG Icons */}
        <div className={`${styles.statusBadge} ${styles[phase]}`}>
          {phase === "balanced" && (
            <>
              <span className={styles.beaconDot} aria-hidden="true" />
              <span>Target Equilibrium · 100%</span>
            </>
          )}
          {phase === "drift" && (
            <>
              <span className={styles.statusIcon} aria-hidden="true"><IconBolt /></span>
              <span>Drift Detected: NVDA +7.0%</span>
            </>
          )}
          {phase === "rebalancing" && (
            <>
              <span className={`${styles.statusIcon} ${styles.spinIcon}`} aria-hidden="true"><IconSync /></span>
              <span>Rebalancing on Base...</span>
            </>
          )}
          {phase === "settled" && (
            <>
              <span className={styles.statusIcon} aria-hidden="true"><IconCheck /></span>
              <span>Settled · Gas $0.002 · 0.4s</span>
            </>
          )}
        </div>
      </div>

      {/* Holdings Rows with Dynamic Progress Bars */}
      <div className={styles.holdingsList}>
        {HOLDINGS.map((item, index) => {
          const currentWeight = weights[index] ?? item.targetWeight;
          const isDriftActive = phase === "drift" && item.symbol === "NVDA";

          return (
            <div
              className={`${styles.holding} ${isDriftActive ? styles.holdingDrifting : ""}`}
              key={item.symbol}
            >
              {/* Dynamic progress bar track */}
              <div
                className={styles.holdingBar}
                style={{
                  width: `${currentWeight}%`,
                  backgroundColor: item.color,
                }}
                aria-hidden="true"
              />

              <span className={styles.holdingIcon}>
                <StockLogo symbol={item.symbol} size={32} roundedFull />
              </span>

              <div className={styles.symbolInfo}>
                <span className={styles.holdingSymbol}>{item.symbol}</span>
                <span className={styles.holdingName}>{item.name}</span>
              </div>

              <div className={styles.weightCol}>
                <strong className={styles.holdingWeight}>{currentWeight}%</strong>
                <span className={styles.targetSub}>
                  {phase === "drift" && item.symbol === "NVDA" ? "Target 40%" : "Allocated"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className={styles.holdingsFoot}>
        <span>THE MIX IS YOURS TO DEFINE</span>
        <span aria-hidden="true">↗</span>
      </div>
    </div>
  );
}
