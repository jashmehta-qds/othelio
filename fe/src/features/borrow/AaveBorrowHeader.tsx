"use client";

import Link from "next/link";
import { type RiskPreference } from "@/lib/lending";

interface AaveBorrowHeaderProps {
  totalCollateralNAV: number;
  totalDebtUsdc: number;
  availableBorrowCapacity: number;
  maxAllowedDebt: number;
  effectiveMaxLtvPct: number;
  riskPref: RiskPreference;
  portfolioHealth: {
    healthFactor: number;
    status: "safe" | "normal" | "risky";
    color: string;
  };
}

export function AaveBorrowHeader({
  totalCollateralNAV,
  totalDebtUsdc,
  availableBorrowCapacity,
  maxAllowedDebt,
  effectiveMaxLtvPct,
  riskPref,
  portfolioHealth,
}: AaveBorrowHeaderProps) {
  // Borrow power used % (0 - 100%)
  const borrowPowerUsedPct = maxAllowedDebt > 0 ? Math.min(100, (totalDebtUsdc / maxAllowedDebt) * 100) : 0;

  return (
    <div className="aave-header-container" style={{ marginBottom: "28px" }}>
      {/* Top Title Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 700, letterSpacing: "-0.5px", margin: 0, color: "var(--ink)" }}>
            Borrow
          </h1>
          <p style={{ color: "var(--muted-ink)", fontSize: "13px", marginTop: "4px" }}>
            Stock basket collateralized lending across multi-venue money markets
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Link
            href="/app/settings"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--muted-ink)",
              textDecoration: "none",
              transition: "color 0.15s ease",
            }}
          >
            <span>Risk Tier:</span>
            <strong style={{ color: portfolioHealth.color, textTransform: "capitalize" }}>
              {riskPref.tier} ({riskPref.bufferPct}% Buffer)
            </strong>
            <span style={{ opacity: 0.6 }}>→</span>
          </Link>
        </div>
      </div>

      {/* Funky Open DeFi Terminal Summary Strip (No Cards, Fluid Layout) */}
      <div
        style={{
          background: "radial-gradient(circle at 10% 20%, rgba(215, 255, 70, 0.06) 0%, rgba(16, 17, 15, 0.98) 80%)",
          border: "1px solid var(--line)",
          borderRadius: "24px",
          padding: "28px 32px",
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.4)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Subtle Background Glow Grid Accent */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: "300px",
            height: "100%",
            background: "radial-gradient(circle at center, rgba(59, 130, 246, 0.05) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />

        {/* Top Flow Header */}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "16px", marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "16px", flexWrap: "wrap" }}>
            {/* Collateral NAV */}
            <div>
              <span style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", color: "var(--muted-ink)", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                Collateral Deposited
              </span>
              <span style={{ fontSize: "36px", fontWeight: 800, color: "var(--ink)", letterSpacing: "-1px", fontFamily: "var(--font-atkinson), sans-serif" }}>
                ${totalCollateralNAV.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            <span style={{ fontSize: "24px", color: "var(--line)", fontWeight: 300, alignSelf: "center" }}>/</span>

            {/* Borrowed Debt */}
            <div>
              <span style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", color: "var(--muted-ink)", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                Borrowed Debt
              </span>
              <span style={{ fontSize: "36px", fontWeight: 800, color: totalDebtUsdc > 0 ? "#3b82f6" : "var(--ink-2)", letterSpacing: "-1px" }}>
                ${totalDebtUsdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Sleek 2-Line Stat Block */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px", fontSize: "13px", color: "var(--muted-ink)", fontWeight: 600 }}>
            {/* Line 1: Max LTV / Health Factor */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span>Max LTV: <strong style={{ color: "var(--ink)" }}>{effectiveMaxLtvPct.toFixed(1)}%</strong></span>
              <span style={{ color: "var(--line)" }}>/</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                Health Factor:{" "}
                <strong style={{ color: portfolioHealth.color, fontSize: "14px" }}>
                  {totalDebtUsdc > 0 ? portfolioHealth.healthFactor.toFixed(2) : "∞"}
                </strong>
                <span style={{ fontSize: "10px", fontWeight: 800, color: portfolioHealth.color, textTransform: "uppercase" }}>
                  ({portfolioHealth.status})
                </span>
              </span>
            </div>

            {/* Line 2: Available Capacity */}
            <div style={{ fontSize: "13px" }}>
              <span>Available: <strong style={{ color: "var(--accent)", fontSize: "15px" }}>${availableBorrowCapacity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
            </div>
          </div>
        </div>

        {/* Funky Integrated Borrow Power Gauge Bar */}
        <div style={{ background: "rgba(255, 255, 255, 0.03)", borderRadius: "14px", padding: "14px 18px", border: "1px solid rgba(255, 255, 255, 0.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: 700, marginBottom: "8px" }}>
            <span style={{ color: "var(--muted-ink)", display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: borrowPowerUsedPct > 80 ? "#ef4444" : "var(--accent)" }} />
              Borrow Power Utilization
            </span>
            <span style={{ color: borrowPowerUsedPct > 80 ? "#ef4444" : "var(--accent)", fontFamily: "monospace" }}>
              {borrowPowerUsedPct.toFixed(1)}% ({totalDebtUsdc > 0 ? `$${totalDebtUsdc.toLocaleString()} used` : "0% used"})
            </span>
          </div>

          {/* Dual Bar Progress */}
          <div style={{ width: "100%", height: "10px", background: "rgba(255, 255, 255, 0.06)", borderRadius: "6px", overflow: "hidden", position: "relative" }}>
            <div
              style={{
                width: `${borrowPowerUsedPct}%`,
                height: "100%",
                background: borrowPowerUsedPct > 80 ? "linear-gradient(90deg, #f59e0b, #ef4444)" : "linear-gradient(90deg, #10b981, #d7ff46)",
                borderRadius: "6px",
                transition: "width 0.4s ease",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--muted-ink)", marginTop: "8px" }}>
            <span>$0.00 Limit</span>
            <span>Safety Buffer Cap: ${maxAllowedDebt.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ({effectiveMaxLtvPct.toFixed(0)}%)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
