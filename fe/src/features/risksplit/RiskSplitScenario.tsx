"use client";

import React, { useId } from "react";
import styles from "./RiskSplitMarkets.module.css";
import { riskSplitPayoff, riskSplitStockFractions } from "./riskSplitPayoff";

interface RiskSplitScenarioProps {
  scenarioPrice: number;
  onChangeScenarioPrice: (newPrice: number) => void;
  selectedClaim: "protected" | "upside";
  floorE8: bigint;
  capE8: bigint;
  stockSymbol: string;
  stockName: string;
  maxAxis?: number;
}

export function RiskSplitScenario({
  scenarioPrice,
  onChangeScenarioPrice,
  selectedClaim,
  floorE8,
  capE8,
  stockSymbol,
  stockName,
  maxAxis = 1600,
}: RiskSplitScenarioProps) {
  const inputId = useId();
  const rangeId = useId();

  const fixingE8 = BigInt(Math.max(0, Math.round(scenarioPrice * 1e8)));
  const payoff = riskSplitPayoff(floorE8, capE8, fixingE8);
  const fractions = riskSplitStockFractions(floorE8, capE8, fixingE8);

  const protectedDollars = (Number(payoff.protectedValueE8) / 1e8).toFixed(2);
  const upsideDollars = (Number(payoff.upsideValueE8) / 1e8).toFixed(2);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val >= 0) {
      onChangeScenarioPrice(val);
    } else if (e.target.value === "") {
      onChangeScenarioPrice(0);
    }
  };

  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      onChangeScenarioPrice(val);
    }
  };

  return (
    <section className={styles.scenarioCard} aria-labelledby="scenario-heading">
      <div className={styles.scenarioHead}>
        <h2 id="scenario-heading">What if {stockName} ends at…</h2>
        <span className={styles.scenarioSubtitle}>Try a stock price</span>
      </div>

      <div className={styles.scenarioControls}>
        <label htmlFor={inputId} className={styles.scenarioLabel}>
          Expiry stock price
        </label>
        <div className={styles.moneyInput}>
          <span>$</span>
          <input
            id={inputId}
            type="number"
            min="0"
            max={maxAxis}
            step="1"
            value={scenarioPrice === 0 ? "" : scenarioPrice}
            onChange={handleInputChange}
            placeholder="0"
            inputMode="decimal"
          />
        </div>
        <input
          id={rangeId}
          type="range"
          min="0"
          max={maxAxis}
          step="1"
          value={Math.min(maxAxis, scenarioPrice)}
          onChange={handleRangeChange}
          aria-label="Expiry stock price slider"
          className={styles.scenarioSlider}
        />
      </div>

      <div className={styles.payoutGrid}>
        <div
          className={`${styles.payoutCard} ${selectedClaim === "protected" ? styles.payoutActive : ""}`}
        >
          <span className={styles.payoutLabel}>Protected receives</span>
          <strong className={styles.payoutAmount}>${protectedDollars}</strong>
          <small className={styles.payoutStock}>{fractions.protectedFractionFormatted} {stockSymbol}</small>
        </div>

        <div
          className={`${styles.payoutCard} ${selectedClaim === "upside" ? styles.payoutActive : ""}`}
        >
          <span className={styles.payoutLabel}>Upside receives</span>
          <strong className={styles.payoutAmount}>${upsideDollars}</strong>
          <small className={styles.payoutStock}>{fractions.upsideFractionFormatted} {stockSymbol}</small>
        </div>
      </div>

      <p className={styles.scenarioNote}>
        Together they equal the stock’s value. <b>Redemption delivers {stockSymbol}, not dollars.</b> Dollar values use the entered expiry price.
      </p>
    </section>
  );
}
