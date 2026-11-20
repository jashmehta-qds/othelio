"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import styles from "./RiskSplitMarkets.module.css";
import { useRiskSplit } from "./useRiskSplit";
import { evaluatePositionActionAvailability } from "./positionLifecycleLogic";

export function RiskSplitActionPanel({
  seriesAddress,
  underlyingSymbol,
  view,
  claimMode = "combine",
}: {
  seriesAddress: string;
  underlyingSymbol: string;
  view: "positions" | "deposit" | "claim";
  claimMode?: "combine" | "redeem";
}) {
  const { activeSeries, balances, onchainState, isPending, actions, unitsCompatible } = useRiskSplit(seriesAddress);
  const { address, isConnected, chainId } = useAccount();

  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const interval = window.setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const [splitAmount, setSplitAmount] = useState<string>("1.0");
  const [combineAmount, setCombineAmount] = useState<string>("1.0");
  const [redeemAmount, setRedeemAmount] = useState<string>("1.0");
  const [redeemClaimType, setRedeemClaimType] = useState<"protected" | "upside">("protected");

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const actionPending = isPending || isSubmitting;

  const lifecycle = evaluatePositionActionAvailability({
    isConnected,
    chainId,
    nowSeconds,
    expiryTimestamp: activeSeries?.expiryTimestamp ?? 0,
    isSettled: onchainState.isSettled,
    underlyingBalance: balances.underlying,
    protectedBalance: balances.protected,
    upsideBalance: balances.upside,
    underlyingAllowance: balances.allowance,
    unitsCompatible,
  });

  const numSplit = parseFloat(splitAmount) || 0;
  const numCombine = parseFloat(combineAmount) || 0;
  const numRedeem = parseFloat(redeemAmount) || 0;
  const needsSplitApproval = lifecycle.needsSplitApproval(splitAmount);

  const handleMaxSplit = () => {
    setSplitAmount(balances.underlying);
  };

  const handleMaxCombine = () => {
    const maxPair = Math.min(parseFloat(balances.protected) || 0, parseFloat(balances.upside) || 0);
    setCombineAmount(maxPair > 0 ? maxPair.toString() : "0");
  };

  const handleMaxRedeem = () => {
    setRedeemAmount(redeemClaimType === "protected" ? balances.protected : balances.upside);
  };

  const handleSplit = async () => {
    if (actionPending) return;
    setStatusMessage(null);
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      if (needsSplitApproval) {
        setStatusMessage(`Approving ${underlyingSymbol} stock token…`);
        await actions.approveUnderlying(splitAmount);
        setStatusMessage(`Approved! Now click Split Stock.`);
        return;
      }
      setStatusMessage("Minting paired Protected and Upside claims…");
      await actions.mint(splitAmount);
      setStatusMessage("Success: Minted paired claims!");
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Split transaction failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCombine = async () => {
    if (actionPending) return;
    setStatusMessage(null);
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      setStatusMessage(`Combining paired claims and withdrawing ${underlyingSymbol}…`);
      await actions.combineAndRedeem(combineAmount);
      setStatusMessage(`Success: Burned paired claims and retrieved ${underlyingSymbol}!`);
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Combine transaction failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRedeem = async () => {
    if (actionPending) return;
    setStatusMessage(null);
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      setStatusMessage(`Redeeming ${redeemClaimType === "protected" ? "Protected" : "Upside"} claim for ${underlyingSymbol} fraction…`);
      if (redeemClaimType === "protected") {
        await actions.redeemProtected(redeemAmount);
      } else {
        await actions.redeemUpside(redeemAmount);
      }
      setStatusMessage(`Success: Redeemed claim for underlying ${underlyingSymbol} fraction!`);
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Redemption transaction failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSettle = async () => {
    if (actionPending) return;
    setStatusMessage(null);
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      setStatusMessage("Triggering oracle settlement via SettlementAdapter…");
      await actions.settleSeries();
      setStatusMessage("Success: Series successfully settled!");
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Settlement failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className={styles.positionSection} aria-label={view === "positions" ? "Your position" : view === "deposit" ? "Deposit stock" : "Claim stock"}>
      <div className={styles.positionHead}>
        <div>
          <h2>{view === "positions" ? "Your position" : view === "deposit" ? "Deposit stock" : "Claim stock"}</h2>
          {view === "positions" && <span className={styles.positionSub}>
            {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Wallet disconnected"}
          </span>}
        </div>
        {view === "positions" && <div className={styles.positionHoldingsStrip}>
          <span><b>{balances.underlying}</b> {underlyingSymbol}</span>
          <span>·</span>
          <span><b>{balances.protected}</b> Protected</span>
          <span>·</span>
          <span><b>{balances.upside}</b> Upside</span>
        </div>}
      </div>

      {lifecycle.guardMessage && (
        <div className={styles.guardAlert} role="note">
          {lifecycle.guardMessage}
        </div>
      )}

      {view !== "positions" && (
        <div className={styles.positionContent}>
          <div className={styles.positionGrid}>
            {(view === "deposit" || claimMode === "combine") && <div className={styles.positionCard}>
              {view === "deposit" ? (
                <div>
                  <p className={styles.positionCardDesc}>
                    Deposit {underlyingSymbol} to mint matching Protected and Upside claims.
                  </p>
                  <div className={styles.positionField}>
                    <div className={styles.positionFieldHead}>
                      <span>Stock Amount</span>
                      <span className={styles.positionAvail}>Avail: {balances.underlying} {underlyingSymbol}</span>
                    </div>
                    <div className={styles.positionInputRow}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.0"
                        value={splitAmount}
                        onChange={(e) => setSplitAmount(e.target.value)}
                        className={styles.positionInput}
                      />
                      <button type="button" onClick={handleMaxSplit} className={styles.positionMaxBtn}>
                        Max
                      </button>
                    </div>
                  </div>

                  <div className={styles.positionPreviewBox}>
                    <span>You get</span>
                    <b>{splitAmount || "0"} Protected + {splitAmount || "0"} Upside</b>
                  </div>
                </div>
              ) : (
                <div>
                  <p className={styles.positionCardDesc}>
                    Burn one of each claim to withdraw {underlyingSymbol}.
                  </p>
                  <div className={styles.positionField}>
                    <div className={styles.positionFieldHead}>
                      <span>Pair Amount</span>
                      <span className={styles.positionAvail}>Max pairs: {lifecycle.maxCombinePair}</span>
                    </div>
                    <div className={styles.positionInputRow}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.0"
                        value={combineAmount}
                        onChange={(e) => setCombineAmount(e.target.value)}
                        className={styles.positionInput}
                      />
                      <button type="button" onClick={handleMaxCombine} className={styles.positionMaxBtn}>
                        Max
                      </button>
                    </div>
                  </div>

                  <div className={styles.positionPreviewBox}>
                    <span>You get</span>
                    <b>{combineAmount || "0"} {underlyingSymbol}</b>
                  </div>
                </div>
              )}
            </div>}

            {view === "claim" && claimMode === "redeem" && <div className={styles.positionCard}>
              <div className={styles.positionCardHead}>
                <h3>Redeem after settlement</h3>
                <span className={styles.positionCardTag}>
                  {onchainState.isSettled ? "Settled" : "Pre-settlement"}
                </span>
              </div>

              <p className={styles.positionCardDesc}>
                Redeem either claim for its {underlyingSymbol} share, <b>not USDC</b>.
              </p>

              {!onchainState.isSettled ? (
                <div className={styles.preSettleNotice}>
                  Available after the expiry price is settled.
                </div>
              ) : (
                <div>
                  <div className={styles.redeemRadioGroup}>
                    <label className={styles.redeemRadioLabel}>
                      <input
                        type="radio"
                        name="redeemClaimType"
                        checked={redeemClaimType === "protected"}
                        onChange={() => setRedeemClaimType("protected")}
                      />
                      Protected ({balances.protected})
                    </label>
                    <label className={styles.redeemRadioLabel}>
                      <input
                        type="radio"
                        name="redeemClaimType"
                        checked={redeemClaimType === "upside"}
                        onChange={() => setRedeemClaimType("upside")}
                      />
                      Upside ({balances.upside})
                    </label>
                  </div>

                  <div className={styles.positionField}>
                    <div className={styles.positionFieldHead}>
                      <span>Claims to Redeem</span>
                      <span className={styles.positionAvail}>
                        Avail: {redeemClaimType === "protected" ? balances.protected : balances.upside}
                      </span>
                    </div>
                    <div className={styles.positionInputRow}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.0"
                        value={redeemAmount}
                        onChange={(e) => setRedeemAmount(e.target.value)}
                        className={styles.positionInput}
                      />
                      <button type="button" onClick={handleMaxRedeem} className={styles.positionMaxBtn}>
                        Max
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>}
          </div>

          {/* Expandable Technical Settlement Details */}
          {view === "claim" && <details className={styles.settlementDisclosure}>
            <summary>Technical settlement operations</summary>
            <div className={styles.settlementDetailsBody}>
              <p>
                Settlement freezes the final settlement price from the verified Chainlink feed and calculates onchain claim fractions for single-claim redemption.
              </p>
              <div className={styles.settleStatusRows}>
                <div>
                  <span>Status:</span>
                  <b>{onchainState.isSettled ? "SETTLED" : "ACTIVE / OPEN"}</b>
                </div>
                {onchainState.isSettled && (
                  <>
                    <div><span>Settled Price:</span><b>{activeSeries?.settledPrice ? `$${(Number(activeSeries.settledPrice) / 1e8).toFixed(2)}` : "—"}</b></div>
                    <div><span>Protected Fraction:</span><b>{onchainState.protectedFraction ?? "—"}</b></div>
                    <div><span>Upside Fraction:</span><b>{onchainState.upsideFraction ?? "—"}</b></div>
                  </>
                )}
              </div>
              {!onchainState.isSettled && (
                <button
                  type="button"
                  disabled={actionPending || !lifecycle.canSettle}
                  onClick={handleSettle}
                  className={`ui-button ${styles.settleBtn}`}
                >
                  {actionPending
                    ? "Confirming settlement…"
                    : !lifecycle.canSettle
                    ? lifecycle.settleDisabledReason
                    : "Trigger Oracle Settlement"}
                </button>
              )}
            </div>
          </details>}
        </div>
      )}

      {view !== "positions" && (
        <div className={styles.positionActionArea}>
          {statusMessage && <div className={styles.statusBox}>{statusMessage}</div>}
          {errorMessage && <div className={styles.errorBox}>{errorMessage}</div>}

          {view === "deposit" ? (
            <button
              type="button"
              disabled={actionPending || !lifecycle.canSplit || numSplit <= 0}
              onClick={handleSplit}
              className={`ui-button ${styles.positionActionBtn}`}
            >
              {actionPending
                ? "Processing…"
                : !lifecycle.canSplit
                ? lifecycle.splitDisabledReason
                : needsSplitApproval
                ? `Approve ${underlyingSymbol} Transfer`
                : `Split ${underlyingSymbol} into Paired Claims`}
            </button>
          ) : claimMode === "combine" ? (
            <button
              type="button"
              disabled={actionPending || !lifecycle.canCombine || numCombine <= 0}
              onClick={handleCombine}
              className={`ui-button ${styles.positionActionBtn}`}
            >
              {actionPending
                ? "Processing…"
                : !lifecycle.canCombine
                ? lifecycle.combineDisabledReason
                : `Combine & Withdraw ${underlyingSymbol}`}
            </button>
          ) : (
            <button
              type="button"
              disabled={actionPending || !onchainState.isSettled || !lifecycle.canRedeem || numRedeem <= 0}
              onClick={handleRedeem}
              className={`ui-button ${styles.positionActionBtn}`}
            >
              {actionPending
                ? "Processing…"
                : !onchainState.isSettled
                ? "Redeem unavailable (pre-settlement)"
                : !lifecycle.canRedeem
                ? lifecycle.redeemDisabledReason
                : `Redeem ${redeemClaimType === "protected" ? "Protected" : "Upside"} for ${underlyingSymbol}`}
            </button>
          )}
        </div>
      )}

      {view === "positions" && (statusMessage || errorMessage) && (
        <>
          {statusMessage && <div className={styles.statusBox}>{statusMessage}</div>}
          {errorMessage && <div className={styles.errorBox}>{errorMessage}</div>}
        </>
      )}
    </section>
  );
}
