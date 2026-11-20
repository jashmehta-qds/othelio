"use client";

import React from "react";
import styles from "./RiskSplitMarkets.module.css";
import { BookLevel } from "./useRiskSplitBook";

interface RiskSplitClaimCardsProps {
  selectedClaim: "protected" | "upside";
  onSelectClaim: (claim: "protected" | "upside") => void;
  protectedBestAsk: BookLevel | null;
  upsideBestAsk: BookLevel | null;
  protectedLoading?: boolean;
  upsideLoading?: boolean;
  protectedError?: boolean;
  upsideError?: boolean;
  stockSymbol: string;
  floor: number;
  cap: number;
  referencePrice?: number;
}

function renderQuote(level: BookLevel | null, loading?: boolean, error?: boolean) {
  if (error) return "Unavailable";
  if (loading) return "Loading…";
  return level ? `${level.priceUsd} USDC` : "No offers";
}

export function RiskSplitClaimCards({
  selectedClaim, onSelectClaim, protectedBestAsk, upsideBestAsk,
  protectedLoading, upsideLoading, protectedError, upsideError,
  stockSymbol, floor, cap, referencePrice,
}: RiskSplitClaimCardsProps) {
  const change = referencePrice && referencePrice > 0
    ? (floor / referencePrice - 1) * 100
    : null;

  return (
    <section className={styles.claimChoiceSection} aria-label={`Choose your side of ${stockSymbol}`}>
      <div className={styles.claimSides} role="group" aria-label="Choose claim">
        <button type="button" onClick={() => onSelectClaim("protected")}
          className={`${styles.claimSideCard} ${selectedClaim === "protected" ? styles.claimSideActive : ""}`}
          aria-pressed={selectedClaim === "protected"}>
          <span className={styles.claimSideName}>Protected</span>
          <span className={styles.claimSideQuote}>{renderQuote(protectedBestAsk, protectedLoading, protectedError)}</span>
        </button>
        <button type="button" onClick={() => onSelectClaim("upside")}
          className={`${styles.claimSideCard} ${selectedClaim === "upside" ? styles.claimSideActive : ""}`}
          aria-pressed={selectedClaim === "upside"}>
          <span className={styles.claimSideName}>Upside</span>
          <span className={styles.claimSideQuote}>{renderQuote(upsideBestAsk, upsideLoading, upsideError)}</span>
        </button>
      </div>
      <div className={styles.claimTerms}>
        <span>Protection threshold <strong>${floor.toFixed(2)}</strong>{change !== null && ` (${change > 0 ? "+" : ""}${change.toFixed(1)}% from stock price)`}</span>
        <span>Protected payout cap <strong>${cap.toFixed(2)}</strong></span>
        <span>Upside above <strong>${floor.toFixed(2)}</strong> · uncapped</span>
      </div>
      <p className={styles.claimRiskNote}>Protected can still lose value; below the threshold it falls with the stock. Upside can finish at zero.</p>
    </section>
  );
}
