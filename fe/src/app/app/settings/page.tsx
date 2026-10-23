"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import {
  getSlippageTolerance,
  setSlippageTolerance,
  clearCreatedBaskets,
} from "@/lib/baskets";
import {
  getRiskTierPreference,
  setRiskTierPreference,
  type RiskTier,
} from "@/lib/lending";
import { WalletConnectModal } from "@/components/WalletConnectModal";
import { Dialog } from "@/components/ui/Dialog";
import { useAuth } from "@/context/AuthContext";
import { fetchAccountSettingsApi, updateAccountSettingsApi } from "@/lib/api";
import styles from "./SettingsPage.module.css";

type Section = "Trading" | "Borrowing" | "Account";
export default function SettingsPage() {
  const { address, chain } = useAccount();
  const { token, isAuthenticated, isAuthenticating, authError, logout, login } =
    useAuth();
  const queryClient = useQueryClient();
  const [section, setSection] = useState<Section>("Trading");
  const [connect, setConnect] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [slippage, setSlippage] = useState("0.5");
  const [riskTier, setRiskTier] = useState<RiskTier>("safe");
  const [buffer, setBuffer] = useState("30");
  const [stale, setStale] = useState<"allow" | "warn" | "reject">("warn");
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!address || !isAuthenticated) return;
    let cancelled = false;
    setNotice(null);
    setDirty(false);
    setLoading(true);
    setSlippage(String(getSlippageTolerance(address)));
    const local = getRiskTierPreference(address);
    setRiskTier(local.tier);
    setBuffer(String(local.bufferPct));
    fetchAccountSettingsApi(address.toLowerCase())
      .then((res) => {
        if (cancelled || !res.data) return;
        setSlippage(String(res.data.slippageTolerance));
        setRiskTier((res.data.riskTier as RiskTier) || "safe");
        setBuffer(String(res.data.customRiskBuffer ?? 30));
        setStale(res.data.stalePriceTrades ?? "warn");
        setSlippageTolerance(res.data.slippageTolerance, address);
        setRiskTierPreference(
          (res.data.riskTier as RiskTier) || "safe",
          res.data.customRiskBuffer ?? undefined,
          address,
        );
      })
      .catch(() => {
        if (!cancelled)
          setNotice({
            text: "Account settings could not be loaded. Your browser preferences are shown. Saving will retry account sync.",
            error: true,
          });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, isAuthenticated]);

  const save = async () => {
    if (!address || !token) return;
    const tolerance = Number(slippage),
      safety = Number(buffer);
    if (
      !slippage.trim() ||
      !Number.isFinite(tolerance) ||
      tolerance < 0.01 ||
      tolerance > 50
    ) {
      setNotice({
        text: "Enter a slippage tolerance between 0.01% and 50%.",
        error: true,
      });
      return;
    }
    if (
      riskTier === "custom" &&
      (!buffer.trim() || !Number.isFinite(safety) || safety < 5 || safety > 50)
    ) {
      setNotice({
        text: "Enter a custom safety buffer between 5% and 50%.",
        error: true,
      });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await updateAccountSettingsApi(
        address,
        {
          slippageTolerance: tolerance,
          riskTier,
          customRiskBuffer: riskTier === "custom" ? safety : null,
          stalePriceTrades: stale,
        },
        token,
      );
      setSlippageTolerance(tolerance, address);
      setRiskTierPreference(
        riskTier,
        riskTier === "custom" ? safety : undefined,
        address,
      );
      setDirty(false);
      setNotice({
        text: "Preferences saved to your account and this browser.",
      });
    } catch {
      setNotice({
        text: "Preferences were not saved. Your changes are still here; try saving again.",
        error: true,
      });
    } finally {
      setSaving(false);
    }
  };
  const change = (update: () => void) => {
    update();
    setDirty(true);
    setNotice(null);
  };

  return (
    <section className={`app-page-frame ${styles.page}`}>
      <header className="ui-page-header">
        <div>
          <h1>Settings</h1>
          <p>Set your trading preferences and manage your account.</p>
        </div>
      </header>
      {!isAuthenticated || !address ? (
        <div className={`ui-state ${styles.gate}`}>
          <h2>
            {address
              ? "Sign in to your account"
              : "Your preferences follow your wallet"}
          </h2>
          <p>
            Connect and verify your wallet to manage trading limits, borrowing
            preferences, and account settings.
          </p>
          {authError && (
            <p className="ui-notice" data-tone="error" role="alert">
              {authError}
            </p>
          )}
          <button
            className="ui-button"
            disabled={isAuthenticating}
            onClick={() => (address ? void login() : setConnect(true))}
          >
            {isAuthenticating
              ? "Waiting for signature…"
              : address
                ? "Sign in with wallet"
                : "Connect wallet"}
          </button>
        </div>
      ) : (
        <>
          <div className={styles.layout}>
            <nav className={styles.navigation} aria-label="Settings categories">
              {(["Trading", "Borrowing", "Account"] as Section[]).map(
                (item) => (
                  <button
                    key={item}
                    aria-current={section === item ? "page" : undefined}
                    onClick={() => setSection(item)}
                  >
                    {item}
                  </button>
                ),
              )}
            </nav>
            <div className={styles.content}>
              {notice && (
                <p
                  className="ui-notice"
                  data-tone={notice.error ? "error" : "success"}
                  role={notice.error ? "alert" : "status"}
                >
                  {notice.text}
                </p>
              )}
              {loading && (
                <p role="status" className={styles.help}>
                  Loading account preferences…
                </p>
              )}
              <fieldset disabled={loading || saving} className={styles.form}>
                {section === "Trading" && (
                  <>
                    <div className={styles.section}>
                      <h2>Slippage tolerance</h2>
                      <p>
                        The maximum price difference you accept when a rebalance
                        executes.
                      </p>
                      <div
                        className={styles.choices}
                        role="group"
                        aria-label="Slippage presets"
                      >
                        {[0.1, 0.5, 1].map((value) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={Number(slippage) === value}
                            onClick={() =>
                              change(() => setSlippage(String(value)))
                            }
                          >
                            {value}%
                          </button>
                        ))}
                      </div>
                      <label className={styles.field}>
                        Custom tolerance (%)
                        <input
                          className="ui-field"
                          type="number"
                          min="0.01"
                          max="50"
                          step="0.01"
                          value={slippage}
                          onChange={(e) =>
                            change(() => setSlippage(e.target.value))
                          }
                        />
                      </label>
                      {Number(slippage) > 1 && (
                        <p className="ui-notice" data-tone="error">
                          A tolerance above 1% can allow less favorable
                          execution prices.
                        </p>
                      )}
                    </div>
                    <div className={styles.section}>
                      <h2>When an oracle price is stale</h2>
                      <p>
                        Choose what happens when a supported asset’s valid price
                        reference exceeds its freshness limit.
                      </p>
                      <div className={styles.options}>
                        {(
                          [
                            {
                              value: "allow",
                              title: "Allow after 15 seconds",
                              detail: "Continue after the waiting period.",
                            },
                            {
                              value: "warn",
                              title: "Warn me",
                              detail: "Show a warning before I continue.",
                            },
                            {
                              value: "reject",
                              title: "Reject the trade",
                              detail: "Require a fresh price reference.",
                            },
                          ] as const
                        ).map((option) => (
                          <label key={option.value}>
                            <input
                              type="radio"
                              name="stale"
                              checked={stale === option.value}
                              onChange={() =>
                                change(() => setStale(option.value))
                              }
                            />
                            <span>
                              <strong>{option.title}</strong>
                              <small>{option.detail}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {section === "Borrowing" && (
                  <div className={styles.section}>
                    <h2>Borrowing safety buffer</h2>
                    <p>
                      Maintain headroom below a pool’s liquidation threshold. A
                      smaller buffer increases liquidation risk.
                    </p>
                    <div className={styles.options}>
                      {(
                        [
                          {
                            value: "safe",
                            title: "Safe",
                            detail: "30% safety headroom",
                          },
                          {
                            value: "normal",
                            title: "Normal",
                            detail: "20% safety headroom",
                          },
                          {
                            value: "risky",
                            title: "Risky",
                            detail: "10% safety headroom",
                          },
                          {
                            value: "custom",
                            title: "Custom",
                            detail: "Choose a buffer from 5% to 50%",
                          },
                        ] as const
                      ).map((option) => (
                        <label key={option.value}>
                          <input
                            type="radio"
                            name="risk"
                            checked={riskTier === option.value}
                            onChange={() =>
                              change(() => setRiskTier(option.value))
                            }
                          />
                          <span>
                            <strong>{option.title}</strong>
                            <small>{option.detail}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                    {riskTier === "custom" && (
                      <label className={styles.field}>
                        Safety buffer (%)
                        <input
                          className="ui-field"
                          type="number"
                          min="5"
                          max="50"
                          value={buffer}
                          onChange={(e) =>
                            change(() => setBuffer(e.target.value))
                          }
                        />
                      </label>
                    )}
                  </div>
                )}
                {section === "Account" && (
                  <>
                    <div className={styles.section}>
                      <h2>Wallet & session</h2>
                      <dl className={styles.facts}>
                        <dt>Wallet</dt>
                        <dd>{address}</dd>
                        <dt>Network</dt>
                        <dd>{chain?.name || "Unavailable"}</dd>
                      </dl>
                      <button
                        className="ui-button"
                        data-variant="secondary"
                        onClick={() => logout()}
                      >
                        Sign out
                      </button>
                    </div>
                    <div className={styles.section}>
                      <h2>Browser data</h2>
                      <p>
                        Clear locally saved baskets, portfolio history, and
                        activity. This does not withdraw funds or delete
                        on-chain holdings.
                      </p>
                      <button
                        className="ui-button"
                        data-variant="danger"
                        onClick={() => setConfirmReset(true)}
                      >
                        Reset local data
                      </button>
                    </div>
                  </>
                )}
              </fieldset>
              {(section !== "Account" || dirty) && (
                <footer className={styles.save}>
                  <span>
                    {dirty
                      ? "You have unsaved changes"
                      : "Preferences are account-specific"}
                  </span>
                  <button
                    className="ui-button"
                    disabled={!dirty || saving || loading}
                    onClick={save}
                  >
                    {saving ? "Saving preferences…" : "Save preferences"}
                  </button>
                </footer>
              )}
            </div>
          </div>
        </>
      )}
      <WalletConnectModal isOpen={connect} onClose={() => setConnect(false)} />
      <Dialog
        open={confirmReset}
        onClose={() => !resetting && setConfirmReset(false)}
        title="Reset local browser data?"
        description="Locally saved baskets, portfolio history, and activity will be removed. This cannot be undone. On-chain holdings are unaffected."
        footer={
          <>
            <button
              className="ui-button"
              data-variant="secondary"
              disabled={resetting}
              onClick={() => setConfirmReset(false)}
            >
              Cancel
            </button>
            <button
              className="ui-button"
              data-variant="danger"
              disabled={resetting}
              onClick={async () => {
                setResetting(true);
                try {
                  await clearCreatedBaskets();
                  queryClient.clear();
                  await queryClient.invalidateQueries();
                  setConfirmReset(false);
                  setNotice({
                    text: "Local basket and activity data cleared.",
                  });
                } catch {
                  setConfirmReset(false);
                  setNotice({
                    text: "Local data could not be reset. Try again.",
                    error: true,
                  });
                } finally {
                  setResetting(false);
                }
              }}
            >
              {resetting ? "Resetting…" : "Reset local data"}
            </button>
          </>
        }
      >
        <p>Your wallet stays connected.</p>
      </Dialog>
    </section>
  );
}
