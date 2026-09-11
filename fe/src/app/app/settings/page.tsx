"use client";

import { useState, useEffect } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { formatAddress, getSlippageTolerance, setSlippageTolerance, clearCreatedBaskets } from "@/lib/baskets";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { getRiskTierPreference, setRiskTierPreference, type RiskTier, RISK_PRESETS } from "@/lib/lending";

export default function SettingsPage() {
  const { address, isConnected, chain } = useAccount();
  const { disconnect } = useDisconnect();
  const queryClient = useQueryClient();

  const [slippage, setSlippageState] = useState<number>(0.5);
  const [customSlippage, setCustomSlippage] = useState<string>("");
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [deadline, setDeadline] = useState<number>(20);
  const [mevProtection, setMevProtection] = useState<boolean>(true);
  const [saveToast, setSaveToast] = useState<boolean>(false);
  const [resetSuccess, setResetSuccess] = useState<boolean>(false);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);

  const [riskTier, setRiskTier] = useState<RiskTier>("safe");
  const [customRiskBuffer, setCustomRiskBuffer] = useState<string>("");
  const [isCustomRisk, setIsCustomRisk] = useState<boolean>(false);

  useEffect(() => {
    const current = getSlippageTolerance();
    setSlippageState(current);
    if (![0.1, 0.5, 1.0].includes(current)) {
      setIsCustom(true);
      setCustomSlippage(current.toString());
    }

    const pref = getRiskTierPreference();
    setRiskTier(pref.tier);
    if (pref.tier === "custom") {
      setIsCustomRisk(true);
      setCustomRiskBuffer(pref.bufferPct.toString());
    }

    if (typeof window !== "undefined") {
      const savedDeadline = localStorage.getItem("othelio_deadline_minutes");
      if (savedDeadline) setDeadline(Number(savedDeadline));

      const savedMev = localStorage.getItem("othelio_mev_protection");
      if (savedMev !== null) setMevProtection(savedMev === "true");
    }
  }, []);

  const handleSelectRiskTier = (tier: Exclude<RiskTier, "custom">) => {
    setIsCustomRisk(false);
    setRiskTier(tier);
    setRiskTierPreference(tier);
    triggerSaveNotification();
  };

  const handleCustomRiskChange = (valStr: string) => {
    setCustomRiskBuffer(valStr);
    const num = parseFloat(valStr);
    if (!isNaN(num) && num >= 5.0 && num <= 50.0) {
      setRiskTier("custom");
      setRiskTierPreference("custom", num);
      triggerSaveNotification();
    }
  };

  const handleSelectPreset = (val: number) => {
    setIsCustom(false);
    setSlippageState(val);
    setSlippageTolerance(val);
    triggerSaveNotification();
  };

  const handleCustomChange = (valStr: string) => {
    setCustomSlippage(valStr);
    const num = parseFloat(valStr);
    if (!isNaN(num) && num >= 0.01 && num <= 50) {
      setSlippageState(num);
      setSlippageTolerance(num);
      triggerSaveNotification();
    }
  };

  const handleDeadlineChange = (val: number) => {
    setDeadline(val);
    if (typeof window !== "undefined") {
      localStorage.setItem("othelio_deadline_minutes", val.toString());
    }
    triggerSaveNotification();
  };

  const handleMevToggle = () => {
    const next = !mevProtection;
    setMevProtection(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("othelio_mev_protection", next.toString());
    }
    triggerSaveNotification();
  };

  const triggerSaveNotification = () => {
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2000);
  };

  return (
    <section className="app-page-frame">
      {/* Index Header matching /app/baskets */}
      <header className="index-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-description">Configure rebalancing slippage limits, execution speed, and account security.</p>
        </div>
        {saveToast && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              background: "rgba(215, 255, 70, 0.12)",
              border: "1px solid rgba(215, 255, 70, 0.3)",
              borderRadius: "20px",
              color: "#d7ff46",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            <span>✓</span> Saved
          </div>
        )}
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "32px", marginTop: "12px" }}>
        {/* Slippage Settings Block */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "16px", padding: "24px" }}>
          <div className="section-title" style={{ marginBottom: "16px" }}>
            <div>
              <h2>Slippage tolerance limit</h2>
              <p>Maximum price impact allowed during DEX swaps when executing or rebalancing basket positions.</p>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", marginTop: "20px" }}>
            {[0.1, 0.5, 1.0].map((preset) => {
              const active = !isCustom && slippage === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  style={{
                    minHeight: "40px",
                    padding: "0 18px",
                    borderRadius: "11px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    border: active ? "1px solid #d7ff46" : "1px solid var(--line)",
                    background: active ? "#d7ff46" : "var(--panel-2)",
                    color: active ? "#10110f" : "var(--ink)",
                  }}
                >
                  {preset}% {preset === 0.5 ? "(Default)" : ""}
                </button>
              );
            })}

            {/* Custom Input Pill */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: "40px",
                padding: "0 14px",
                borderRadius: "11px",
                border: isCustom ? "1px solid #d7ff46" : "1px solid var(--line)",
                background: "var(--panel-2)",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setIsCustom(true);
                  if (customSlippage) handleCustomChange(customSlippage);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: isCustom ? "#d7ff46" : "var(--muted-ink)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  marginRight: "4px",
                  padding: 0,
                }}
              >
                Custom:
              </button>
              <input
                type="number"
                step="0.1"
                min="0.01"
                max="50"
                placeholder="1.5"
                value={isCustom ? customSlippage : ""}
                onFocus={() => setIsCustom(true)}
                onChange={(e) => handleCustomChange(e.target.value)}
                style={{
                  width: "50px",
                  background: "none",
                  border: "none",
                  color: "var(--ink)",
                  fontSize: "13px",
                  fontWeight: 600,
                  outline: "none",
                  fontFamily: "var(--font-atkinson), sans-serif",
                }}
              />
              <span style={{ color: "var(--muted-ink)", fontSize: "12px", fontWeight: 600 }}>%</span>
            </div>
          </div>

          {/* High Slippage Warning */}
          {slippage > 1.0 && (
            <div
              style={{
                marginTop: "18px",
                padding: "12px 16px",
                borderRadius: "12px",
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                color: "#ff7770",
                fontSize: "12px",
              }}
            >
              <span style={{ width: "16px", height: "16px", display: "inline-flex", flexShrink: 0 }}>
                <AppIcon type="alert" />
              </span>
              <div>
                <strong>High Slippage Warning ({slippage}%)</strong>: Setting slippage tolerance above 1.0% may result in unfavorable rates during rebalancing swaps.
              </div>
            </div>
          )}
        </div>

        {/* Borrowing Safety & Risk Buffer Block */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "16px", padding: "24px" }}>
          <div className="section-title" style={{ marginBottom: "16px" }}>
            <div>
              <h2>Borrowing safety & risk buffer preferences</h2>
              <p>Set how much safety headroom to maintain below pool liquidation thresholds when borrowing USDC against stock baskets.</p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginTop: "20px" }}>
            {/* Safe Preset */}
            <button
              type="button"
              onClick={() => handleSelectRiskTier("safe")}
              style={{
                padding: "16px",
                borderRadius: "14px",
                textAlign: "left",
                cursor: "pointer",
                border: !isCustomRisk && riskTier === "safe" ? "1px solid #10b981" : "1px solid var(--line)",
                background: !isCustomRisk && riskTier === "safe" ? "rgba(16, 185, 129, 0.08)" : "var(--panel-2)",
                transition: "all 0.15s ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ color: "#10b981", fontSize: "14px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "16px", height: "16px", display: "inline-flex" }}>
                    <AppIcon type="shield" />
                  </span>
                  Safe (30%)
                </span>
                {!isCustomRisk && riskTier === "safe" && (
                  <span style={{ fontSize: "11px", background: "rgba(16, 185, 129, 0.2)", color: "#10b981", padding: "2px 6px", borderRadius: "6px", fontWeight: 700 }}>
                    Active
                  </span>
                )}
              </div>
              <p style={{ fontSize: "11px", color: "var(--muted-ink)", margin: 0, lineHeight: 1.4 }}>
                Maintains 30.0% safety headroom below pool liquidation threshold. (Max 50.0% LTV on Aave v3)
              </p>
            </button>

            {/* Normal Preset */}
            <button
              type="button"
              onClick={() => handleSelectRiskTier("normal")}
              style={{
                padding: "16px",
                borderRadius: "14px",
                textAlign: "left",
                cursor: "pointer",
                border: !isCustomRisk && riskTier === "normal" ? "1px solid #f59e0b" : "1px solid var(--line)",
                background: !isCustomRisk && riskTier === "normal" ? "rgba(245, 158, 11, 0.08)" : "var(--panel-2)",
                transition: "all 0.15s ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ color: "#f59e0b", fontSize: "14px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "16px", height: "16px", display: "inline-flex" }}>
                    <AppIcon type="alert" />
                  </span>
                  Normal (20%)
                </span>
                {!isCustomRisk && riskTier === "normal" && (
                  <span style={{ fontSize: "11px", background: "rgba(245, 158, 11, 0.2)", color: "#f59e0b", padding: "2px 6px", borderRadius: "6px", fontWeight: 700 }}>
                    Active
                  </span>
                )}
              </div>
              <p style={{ fontSize: "11px", color: "var(--muted-ink)", margin: 0, lineHeight: 1.4 }}>
                Maintains 20.0% safety headroom below pool threshold. (Max 60.0% LTV on Aave v3)
              </p>
            </button>

            {/* Risky Preset */}
            <button
              type="button"
              onClick={() => handleSelectRiskTier("risky")}
              style={{
                padding: "16px",
                borderRadius: "14px",
                textAlign: "left",
                cursor: "pointer",
                border: !isCustomRisk && riskTier === "risky" ? "1px solid #ef4444" : "1px solid var(--line)",
                background: !isCustomRisk && riskTier === "risky" ? "rgba(239, 68, 68, 0.08)" : "var(--panel-2)",
                transition: "all 0.15s ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ color: "#ef4444", fontSize: "14px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "16px", height: "16px", display: "inline-flex" }}>
                    <AppIcon type="alert" />
                  </span>
                  Risky (10% Min)
                </span>
                {!isCustomRisk && riskTier === "risky" && (
                  <span style={{ fontSize: "11px", background: "rgba(239, 68, 68, 0.2)", color: "#ef4444", padding: "2px 6px", borderRadius: "6px", fontWeight: 700 }}>
                    Active
                  </span>
                )}
              </div>
              <p style={{ fontSize: "11px", color: "var(--muted-ink)", margin: 0, lineHeight: 1.4 }}>
                Min 10.0% safety headroom threshold. Maximizes leverage closer to liquidation limit. (Max 70.0% LTV)
              </p>
            </button>
          </div>

          {/* Custom Risk Buffer Input */}
          <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: "40px",
                padding: "0 14px",
                borderRadius: "11px",
                border: isCustomRisk ? "1px solid #d7ff46" : "1px solid var(--line)",
                background: "var(--panel-2)",
              }}
            >
              <span style={{ color: "var(--muted-ink)", fontSize: "12px", fontWeight: 600, marginRight: "6px" }}>
                Custom Safety Buffer:
              </span>
              <input
                type="number"
                step="1"
                min="5"
                max="50"
                placeholder="25"
                value={isCustomRisk ? customRiskBuffer : ""}
                onFocus={() => setIsCustomRisk(true)}
                onChange={(e) => handleCustomRiskChange(e.target.value)}
                style={{
                  width: "50px",
                  background: "none",
                  border: "none",
                  color: "var(--ink)",
                  fontSize: "13px",
                  fontWeight: 600,
                  outline: "none",
                }}
              />
              <span style={{ color: "var(--muted-ink)", fontSize: "12px", fontWeight: 600 }}>%</span>
            </div>
            {isCustomRisk && (
              <span style={{ fontSize: "12px", color: "#d7ff46", fontWeight: 600 }}>
                Custom buffer active ({customRiskBuffer || 30}%)
              </span>
            )}
          </div>
        </div>

        {/* Transaction Expiry & MEV Policy Block */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "16px", padding: "24px" }}>
          <div className="section-title" style={{ marginBottom: "16px" }}>
            <div>
              <h2>Transaction expiry & MEV policy</h2>
              <p>Control order deadline thresholds and private transaction routing for basket execution.</p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong style={{ fontSize: "13px", color: "var(--ink)" }}>Transaction Deadline</strong>
                <p style={{ fontSize: "11px", color: "var(--muted-ink)", margin: "2px 0 0" }}>
                  Transactions revert automatically if not confirmed within this window.
                </p>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                {[10, 20, 30].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => handleDeadlineChange(mins)}
                    style={{
                      minHeight: "36px",
                      padding: "0 14px",
                      borderRadius: "9px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      border: deadline === mins ? "1px solid #d7ff46" : "1px solid var(--line)",
                      background: deadline === mins ? "#d7ff46" : "var(--panel-2)",
                      color: deadline === mins ? "#10110f" : "var(--ink)",
                    }}
                  >
                    {mins}m
                  </button>
                ))}
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--line)", paddingTop: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong style={{ fontSize: "13px", color: "var(--ink)" }}>MEV / Front-Running Protection</strong>
                <p style={{ fontSize: "11px", color: "var(--muted-ink)", margin: "2px 0 0" }}>
                  Route rebalance transactions through private mempools to prevent sandwich attacks.
                </p>
              </div>
              <button
                type="button"
                onClick={handleMevToggle}
                style={{
                  width: "44px",
                  height: "24px",
                  borderRadius: "12px",
                  background: mevProtection ? "#d7ff46" : "var(--panel-2)",
                  border: "1px solid var(--line)",
                  cursor: "pointer",
                  position: "relative",
                  transition: "background 0.2s ease",
                }}
              >
                <div
                  style={{
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    background: mevProtection ? "#10110f" : "var(--muted-ink)",
                    position: "absolute",
                    top: "2px",
                    left: mevProtection ? "22px" : "2px",
                    transition: "left 0.2s ease",
                  }}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Connected Wallet Account Info Block */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "16px", padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--ink)", margin: 0 }}>
                Connected Wallet & Network
              </h2>
              <p style={{ fontSize: "12px", color: "var(--muted-ink)", margin: "4px 0 0" }}>
                {isConnected && address ? `${formatAddress(address)} · ${chain?.name || "Anvil Local"}` : "No wallet connected"}
              </p>
            </div>
            {isConnected && (
              <button
                type="button"
                onClick={() => disconnect()}
                style={{
                  minHeight: "36px",
                  padding: "0 16px",
                  borderRadius: "9px",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  background: "rgba(239, 68, 68, 0.08)",
                  color: "#ff7770",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>

        {/* Developer Controls & Reset State Block */}
        <div style={{ background: "var(--panel)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "16px", padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ background: "rgba(239, 68, 68, 0.15)", color: "#ff7770", fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "4px", textTransform: "uppercase" }}>Dev Control</span>
                <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--ink)", margin: 0 }}>
                  Reset Environment & Baskets
                </h2>
              </div>
              <p style={{ fontSize: "12px", color: "var(--muted-ink)", margin: "4px 0 0" }}>
                Delete all locally saved baskets, clear mock activity, and reset portfolio state to start completely fresh.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowConfirmModal(true)}
              style={{
                minHeight: "38px",
                padding: "0 18px",
                borderRadius: "10px",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                background: "rgba(239, 68, 68, 0.12)",
                color: "#ff7770",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              Delete All Baskets & Start Fresh
            </button>
          </div>
          {resetSuccess && (
            <div
              style={{
                marginTop: "16px",
                padding: "10px 14px",
                borderRadius: "10px",
                background: "rgba(215, 255, 70, 0.12)",
                border: "1px solid rgba(215, 255, 70, 0.3)",
                color: "#d7ff46",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              ✓ Reset complete: All local baskets and activity state cleared.
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "20px",
              padding: "28px",
              maxWidth: "440px",
              width: "100%",
              boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
            }}
          >
            <h3 style={{ margin: "0 0 8px 0", fontSize: "18px", color: "var(--ink)", fontWeight: 700 }}>
              Delete All Baskets & Start Fresh?
            </h3>
            <p style={{ fontSize: "13px", color: "var(--muted-ink)", margin: "0 0 24px 0", lineHeight: "1.5" }}>
              This will permanently delete all created baskets, local portfolio history, and transaction logs from your browser. This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                style={{
                  padding: "8px 18px",
                  borderRadius: "10px",
                  background: "var(--panel-2)",
                  border: "1px solid var(--line)",
                  color: "var(--ink)",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await clearCreatedBaskets();
                  queryClient.clear();
                  queryClient.invalidateQueries();
                  setResetSuccess(true);
                  setShowConfirmModal(false);
                  setTimeout(() => setResetSuccess(false), 3000);
                }}
                style={{
                  padding: "8px 18px",
                  borderRadius: "10px",
                  background: "#ef4444",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
