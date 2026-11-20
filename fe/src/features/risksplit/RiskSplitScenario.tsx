"use client";

import React, { useId } from "react";
import styles from "./RiskSplitMarkets.module.css";
import { riskSplitPayoff } from "./riskSplitPayoff";

interface RiskSplitScenarioProps {
  scenarioPrice: number;
  onChangeScenarioPrice: (newPrice: number) => void;
  selectedClaim: "protected" | "upside";
  floorE8: bigint;
  capE8: bigint;
  stockSymbol: string;
  maxAxis?: number;
  referencePrice?: number;
}

export function RiskSplitScenario({
  scenarioPrice,
  onChangeScenarioPrice,
  selectedClaim,
  floorE8,
  capE8,
  stockSymbol,
  maxAxis = 1600,
  referencePrice,
}: RiskSplitScenarioProps) {
  const inputId = useId();

  const fixingE8 = BigInt(Math.max(0, Math.round(scenarioPrice * 1e8)));
  const payoff = riskSplitPayoff(floorE8, capE8, fixingE8);

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

  return (
    <section className={styles.scenarioCard} aria-labelledby="scenario-heading">
      <div className={styles.scenarioHead}>
        <h2 id="scenario-heading">2. Payout preview</h2>
        <span className={styles.scenarioSubtitle}>Per claim</span>
      </div>

      <div className={styles.scenarioControls}>
        <label htmlFor={inputId} className={styles.scenarioLabel}>
          If {stockSymbol} ends at
        </label>
        <div className={styles.moneyInput}>
          <span>$</span>
          <input
            id={inputId}
            type="number"
            min="0"
            max={maxAxis}
            step="0.01"
            value={scenarioPrice === 0 ? "" : scenarioPrice}
            onChange={handleInputChange}
            placeholder="0"
            inputMode="decimal"
          />
        </div>
        {referencePrice !== undefined && referencePrice > 0 && <div className={styles.scenarioPresets} role="group" aria-label="Example ending prices">
          {[{ label: '−20%', multiple: 0.8 }, { label: 'Flat', multiple: 1 }, { label: '+20%', multiple: 1.2 }].map(({ label, multiple }) => {
            const price = Math.round(referencePrice * multiple * 100) / 100;
            return <button key={label} type="button" aria-label={`${label} · $${price.toFixed(2)} ending price`} aria-pressed={scenarioPrice === price} onClick={() => onChangeScenarioPrice(price)}>{label}</button>;
          })}
        </div>}
      </div>

      <div className={styles.payoutGrid} aria-live="polite">
        <div
          className={`${styles.payoutCard} ${selectedClaim === "protected" ? styles.payoutActive : ""}`}
        >
          <span className={styles.payoutLabel}>Protected</span>
          <strong className={styles.payoutAmount}>${protectedDollars}</strong>
        </div>

        <div
          className={`${styles.payoutCard} ${selectedClaim === "upside" ? styles.payoutActive : ""}`}
        >
          <span className={styles.payoutLabel}>Upside</span>
          <strong className={styles.payoutAmount}>${upsideDollars}</strong>
        </div>
      </div>

      <p className={styles.scenarioNote}>
        Before purchase cost. Paid in {stockSymbol}, not cash. Illustration, not a forecast.
      </p>
    </section>
  );
}
