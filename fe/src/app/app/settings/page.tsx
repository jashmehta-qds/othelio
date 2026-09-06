"use client";

import { useState, useEffect } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { formatAddress, getSlippageTolerance, setSlippageTolerance } from "@/lib/baskets";

export default function SettingsPage() {
  const { address, isConnected, chain } = useAccount();
  const { disconnect } = useDisconnect();

  const [slippage, setSlippageState] = useState<number>(0.5);
  const [customSlippage, setCustomSlippage] = useState<string>("");
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [deadline, setDeadline] = useState<number>(20);
  const [mevProtection, setMevProtection] = useState<boolean>(true);
  const [saveToast, setSaveToast] = useState<boolean>(false);

  useEffect(() => {
    const current = getSlippageTolerance();
    setSlippageState(current);
    if (![0.1, 0.5, 1.0].includes(current)) {
      setIsCustom(true);
      setCustomSlippage(current.toString());
    }

    if (typeof window !== "undefined") {
      const savedDeadline = localStorage.getItem("othelio_deadline_minutes");
      if (savedDeadline) setDeadline(Number(savedDeadline));

      const savedMev = localStorage.getItem("othelio_mev_protection");
      if (savedMev !== null) setMevProtection(savedMev === "true");
    }
  }, []);

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
    <section className="basket-index" style={{ maxWidth: "880px", margin: "0 auto" }}>
      {/* Index Header matching /app/baskets */}
      <header className="index-head">
        <div>
          <h1>Settings</h1>
          <p>Configure rebalancing slippage limits, execution speed, and account security.</p>
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
              <span>⚠️</span>
              <div>
                <strong>High Slippage Warning ({slippage}%)</strong>: Setting slippage tolerance above 1.0% may result in unfavorable rates during rebalancing swaps.
              </div>
            </div>
          )}
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
      </div>
    </section>
  );
}
