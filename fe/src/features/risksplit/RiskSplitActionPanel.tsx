"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import styles from "./RiskSplitComponents.module.css";
import { useRiskSplit } from "./useRiskSplit";

type ActionTab = "split" | "combine" | "redeem" | "settle";

export function RiskSplitActionPanel({ seriesAddress, underlyingSymbol }: { seriesAddress: string; underlyingSymbol: string }) {
  const { activeSeries, balances, onchainState, isPending, actions, unitsCompatible } = useRiskSplit(seriesAddress);
  const { address, chainId } = useAccount();
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const interval = window.setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  const [tab, setTab] = useState<ActionTab>("split");
  const [amount, setAmount] = useState<string>("1.0");
  const [redeemClaimType, setRedeemClaimType] = useState<"protected" | "upside">("protected");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const actionPending = isPending || isSubmitting;

  const numAmount = parseFloat(amount) || 0;
  const numAllowance = parseFloat(balances.allowance) || 0;
  const needsApproval = tab === "split" && numAllowance < numAmount;
  const canWrite = Boolean(address && chainId === 8453 && unitsCompatible);
  const canMint = canWrite && Boolean(activeSeries && !onchainState.isSettled && activeSeries.expiryTimestamp > nowSeconds);

  const handleMax = () => {
    if (tab === "split") {
      setAmount(balances.underlying);
    } else if (tab === "combine") {
      const maxPair = Math.min(parseFloat(balances.protected), parseFloat(balances.upside));
      setAmount(maxPair.toString());
    } else if (tab === "redeem") {
      setAmount(redeemClaimType === "protected" ? balances.protected : balances.upside);
    }
  };

  const executeAction = async () => {
    if (actionPending) return;
    setStatusMessage(null);
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      if (tab === "split") {
        if (needsApproval) {
          setStatusMessage("Approving underlying stock token...");
          await actions.approveUnderlying(amount);
          setStatusMessage("Approved! Now click Split Stock.");
          return;
        }
        setStatusMessage("Minting Protected and Upside claims...");
        await actions.mint(amount);
        setStatusMessage("Success: Minted paired claims!");
      } else if (tab === "combine") {
        setStatusMessage("Combining pair and redeeming stock token...");
        await actions.combineAndRedeem(amount);
        setStatusMessage("Success: Burned paired claims and retrieved stock!");
      } else if (tab === "redeem") {
        if (redeemClaimType === "protected") {
          setStatusMessage("Redeeming Protected claim for stock fraction...");
          await actions.redeemProtected(amount);
        } else {
          setStatusMessage("Redeeming Upside claim for stock fraction...");
          await actions.redeemUpside(amount);
        }
        setStatusMessage("Success: Redeemed claim for underlying stock!");
      } else if (tab === "settle") {
        setStatusMessage("Triggering oracle settlement via SettlementAdapter...");
        await actions.settleSeries();
        setStatusMessage("Success: Series successfully settled!");
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`ui-panel ${styles.card}`}>
      {/* Tabs */}
      <div className={styles.tabList}>
        <button
          type="button"
          className={`${styles.tabBtn} ${tab === "split" ? styles.tabBtnActive : ""}`}
          onClick={() => setTab("split")}
        >
          Split Stock
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${tab === "combine" ? styles.tabBtnActive : ""}`}
          onClick={() => setTab("combine")}
        >
          Combine Pair
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${tab === "redeem" ? styles.tabBtnActive : ""}`}
          onClick={() => setTab("redeem")}
        >
          Redeem Claim
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${tab === "settle" ? styles.tabBtnActive : ""}`}
          onClick={() => setTab("settle")}
        >
          Settlement
        </button>
      </div>

      <div className={styles.tabContent}>
        {tab === "split" && (
          <div>
            <p className={styles.tabDesc}>
              Deposit raw stock tokens into escrow to mint 1 Protected and 1 Upside claim per token.
            </p>
            <div className={styles.inputGroup}>
              <div className={styles.inputHeader}>
                <span>Stock Amount</span>
                <span className={styles.balanceInfo}>
                  Avail: {balances.underlying} {underlyingSymbol}
                </span>
              </div>
              <div className={styles.inputRow}>
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  className={styles.numInput}
                />
                <button type="button" onClick={handleMax} className={styles.maxBtn}>
                  MAX
                </button>
              </div>
            </div>

            <div className={styles.previewBox}>
              <div className={styles.previewRow}>
                <span>You will receive:</span>
                <b>{amount || "0"} PROT + {amount || "0"} UP</b>
              </div>
              <div className={styles.previewRow}>
                <span>Liabilities backed:</span>
                <b>100% Escrowed</b>
              </div>
            </div>

            <button
              type="button"
              disabled={actionPending || numAmount <= 0 || !canMint}
              onClick={executeAction}
              className={`ui-button ${styles.actionBtn}`}
            >
              {actionPending
                ? "Confirming transaction..."
                : !canMint && activeSeries && activeSeries.expiryTimestamp <= nowSeconds
                ? "Series expired"
                : needsApproval
                ? `Approve ${underlyingSymbol} Transfer`
                : "Split Stock into Paired Claims"}
            </button>
          </div>
        )}

        {tab === "combine" && (
          <div>
            <p className={styles.tabDesc}>
              Combine 1 Protected and 1 Upside claim together to withdraw 1 raw stock token.
            </p>
            <div className={styles.inputGroup}>
              <div className={styles.inputHeader}>
                <span>Pair Amount</span>
                <span className={styles.balanceInfo}>
                  Prot: {balances.protected} | Up: {balances.upside}
                </span>
              </div>
              <div className={styles.inputRow}>
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  className={styles.numInput}
                />
                <button type="button" onClick={handleMax} className={styles.maxBtn}>
                  MAX
                </button>
              </div>
            </div>

            <div className={styles.previewBox}>
              <div className={styles.previewRow}>
                <span>Burning:</span>
                <b>{amount || "0"} PROT + {amount || "0"} UP</b>
              </div>
              <div className={styles.previewRow}>
                <span>You will receive:</span>
                <b className={styles.mintText}>{amount || "0"} {underlyingSymbol}</b>
              </div>
            </div>

            <button
              type="button"
              disabled={actionPending || numAmount <= 0 || !canWrite}
              onClick={executeAction}
              className={`ui-button ${styles.actionBtn}`}
            >
              {actionPending ? "Confirming transaction..." : "Combine & Redeem Stock"}
            </button>
          </div>
        )}

        {tab === "redeem" && (
          <div>
            <p className={styles.tabDesc}>
              After expiry settlement, either claim can redeem independently for its calculated stock fraction.
            </p>
            {!onchainState.isSettled ? (
              <div className={styles.alertWarning}>
                Series has not been settled yet. Single claim redemption unlocks once the settlement price is verified.
              </div>
            ) : null}

            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="claimType"
                  checked={redeemClaimType === "protected"}
                  onChange={() => setRedeemClaimType("protected")}
                />
                Protected ({balances.protected})
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="claimType"
                  checked={redeemClaimType === "upside"}
                  onChange={() => setRedeemClaimType("upside")}
                />
                Upside ({balances.upside})
              </label>
            </div>

            <div className={styles.inputGroup}>
              <div className={styles.inputHeader}>
                <span>Claim Amount to Burn</span>
              </div>
              <div className={styles.inputRow}>
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  className={styles.numInput}
                />
                <button type="button" onClick={handleMax} className={styles.maxBtn}>
                  MAX
                </button>
              </div>
            </div>

            <button
              type="button"
              disabled={actionPending || !onchainState.isSettled || numAmount <= 0 || !canWrite}
              onClick={executeAction}
              className={`ui-button ${styles.actionBtn}`}
            >
              {actionPending
                ? "Confirming transaction..."
                : `Redeem ${redeemClaimType === "protected" ? "Protected" : "Upside"} Claim`}
            </button>
          </div>
        )}

        {tab === "settle" && (
          <div>
            <p className={styles.tabDesc}>
              Validates Chainlink oracle price freshness and freezes normalized claim fractions for post-expiry redemption.
            </p>
            <div className={styles.settleStatusBox}>
              <div className={styles.previewRow}>
                <span>Settlement Status:</span>
                <b>{onchainState.isSettled ? "SETTLED" : "OPEN / ACTIVE"}</b>
              </div>
              {onchainState.isSettled && (
                <>
                  <div className={styles.previewRow}>
                    <span>Protected Fraction:</span>
                    <b className={styles.mintText}>{onchainState.protectedFraction}</b>
                  </div>
                  <div className={styles.previewRow}>
                    <span>Upside Fraction:</span>
                    <b className={styles.goldText}>{onchainState.upsideFraction}</b>
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              disabled={actionPending || onchainState.isSettled || !canWrite || !activeSeries || activeSeries.expiryTimestamp > nowSeconds}
              onClick={executeAction}
              className={`ui-button ${styles.actionBtn}`}
            >
              {actionPending
                ? "Confirming settlement..."
                : onchainState.isSettled
                ? "Series Already Settled"
                : activeSeries && activeSeries.expiryTimestamp > nowSeconds
                ? "Available after expiry"
                : "Trigger Oracle Settlement"}
            </button>
          </div>
        )}

        {statusMessage && <div className={styles.statusBox}>{statusMessage}</div>}
        {errorMessage && <div className={styles.errorBox}>{errorMessage}</div>}
        {!canWrite && <div className={styles.alertWarning}>{!address ? "Connect a wallet to manage claims." : chainId !== 8453 ? "Switch your wallet to Base to manage claims." : "Token decimals are being verified; actions are unavailable until the claim units match the underlying."}</div>}
      </div>
    </div>
  );
}
