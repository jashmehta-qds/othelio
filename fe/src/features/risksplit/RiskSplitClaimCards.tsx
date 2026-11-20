"use client";

import React from "react";
import styles from "./RiskSplitMarkets.module.css";
import { BookLevel } from "./useRiskSplitBook";

interface RiskSplitClaimCardsProps {
  selectedClaim: "protected" | "upside";
  onSelectClaim: (claim: "protected" | "upside") => void;
  protectedBestAsk: BookLevel | null;
  protectedBestBid: BookLevel | null;
  upsideBestAsk: BookLevel | null;
  upsideBestBid: BookLevel | null;
  protectedLoading?: boolean;
  upsideLoading?: boolean;
  protectedError?: boolean;
  upsideError?: boolean;
  stockSymbol: string;
}

function renderQuote(
  level: BookLevel | null,
  isLoading?: boolean,
  isError?: boolean,
  fallback = "None",
): React.ReactNode {
  if (isLoading && !isError) {
    return <span className={styles.numberSkeleton} role="status" aria-label="Loading quote" />;
  }
  if (isError) return "—";
  if (!level) return fallback;
  return level.priceUsd;
}

export function RiskSplitClaimCards({
  selectedClaim,
  onSelectClaim,
  protectedBestAsk,
  protectedBestBid,
  upsideBestAsk,
  upsideBestBid,
  protectedLoading,
  upsideLoading,
  protectedError,
  upsideError,
  stockSymbol,
}: RiskSplitClaimCardsProps) {
  const isProtectedActive = selectedClaim === "protected";
  const isUpsideActive = selectedClaim === "upside";

  return (
    <section className={styles.claimChoiceSection} aria-labelledby="claim-choice-heading">
      <div className={styles.claimChoiceHead}>
        <h2 id="claim-choice-heading">Choose a side</h2>
        <p>Two claims on one {stockSymbol} token</p>
      </div>

      <div className={styles.claimSides} role="group" aria-label="Choose claim">
        {/* Protected Card */}
        <button
          type="button"
          onClick={() => onSelectClaim("protected")}
          className={`${styles.claimSideCard} ${isProtectedActive ? styles.claimSideActive : ""}`}
          aria-pressed={isProtectedActive}
        >
          <div className={styles.claimSideTop}>
            <span className={styles.claimSideName}>Protected</span>
          </div>

          <p className={styles.claimSideDesc}>
            More stock value at lower prices. Still carries loss risk.
          </p>

          <div className={styles.claimSideBottom}>
            <span className={styles.claimSideQuote}>
              Buy from{" "}
              <b>
                {renderQuote(
                  protectedBestAsk,
                  protectedLoading,
                  protectedError,
                  "No offers",
                )}
              </b>
            </span>
            <span className={styles.claimSideQuote}>
              Sell at{" "}
              <b>
                {renderQuote(
                  protectedBestBid,
                  protectedLoading,
                  protectedError,
                  "No bids",
                )}
              </b>
            </span>
          </div>
        </button>

        {/* Upside Card */}
        <button
          type="button"
          onClick={() => onSelectClaim("upside")}
          className={`${styles.claimSideCard} ${isUpsideActive ? styles.claimSideActive : ""}`}
          aria-pressed={isUpsideActive}
        >
          <div className={styles.claimSideTop}>
            <span className={styles.claimSideName}>Upside</span>
          </div>

          <p className={styles.claimSideDesc}>
            More stock value as the price rises.
          </p>

          <div className={styles.claimSideBottom}>
            <span className={styles.claimSideQuote}>
              Buy from{" "}
              <b>
                {renderQuote(
                  upsideBestAsk,
                  upsideLoading,
                  upsideError,
                  "No offers",
                )}
              </b>
            </span>
            <span className={styles.claimSideQuote}>
              Sell at{" "}
              <b>
                {renderQuote(
                  upsideBestBid,
                  upsideLoading,
                  upsideError,
                  "No bids",
                )}
              </b>
            </span>
          </div>
        </button>
      </div>
    </section>
  );
}
