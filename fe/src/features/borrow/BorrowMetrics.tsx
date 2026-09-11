"use client";

import Link from "next/link";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { RiskPreference } from "@/lib/lending";

interface BorrowMetricsProps {
  totalCollateralNAV: number;
  totalDebtUsdc: number;
  availableBorrowCapacity: number;
  effectiveMaxLtvPct: number;
  riskPref: RiskPreference;
  portfolioHealth: {
    healthFactor: number;
    status: "safe" | "normal" | "risky";
    color: string;
  };
}

export function BorrowMetrics({
  totalCollateralNAV,
  totalDebtUsdc,
  availableBorrowCapacity,
  effectiveMaxLtvPct,
  riskPref,
  portfolioHealth,
}: BorrowMetricsProps) {
  return (
    <div className="borrow-metrics-container" style={{ marginBottom: "24px" }}>
      {/* Header Bar */}
      <header className="index-head" style={{ marginBottom: "20px" }}>
        <div>
          <h1 className="page-title">
            Borrow
          </h1>
          <p style={{ color: "var(--muted-ink)", fontSize: "13px", marginTop: "4px" }}>
            Manage stock basket collateral, loan health factors, and active USDC borrows.
          </p>
        </div>
        <Link
          href="/app/settings"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 16px",
            background: "var(--panel-2)",
            border: "1px solid var(--line)",
            borderRadius: "12px",
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--ink)",
            textDecoration: "none",
          }}
        >
          <span style={{ width: "14px", height: "14px", display: "inline-flex" }}>
            <AppIcon type="settings" />
          </span>
          Risk Tier:{" "}
          <strong style={{ color: portfolioHealth.color, textTransform: "capitalize" }}>
            {riskPref.tier} ({riskPref.bufferPct}% Buffer)
          </strong>
        </Link>
      </header>

      {/* Metrics Row */}
      <div className="metric-grid">
        {/* Collateral NAV */}
        <div className="metric-card">
          <div className="metric-card-label">
            <span style={{ width: "16px", height: "16px", display: "inline-flex", color: "var(--accent)" }}>
              <AppIcon type="baskets" />
            </span>
            Total Collateral NAV
          </div>
          <strong className="metric-card-value">
            ${totalCollateralNAV.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </strong>
          <span className="metric-card-subtext">Stock basket holdings</span>
        </div>

        {/* Total Borrowed Debt */}
        <div className="metric-card">
          <div className="metric-card-label">
            <span style={{ width: "16px", height: "16px", display: "inline-flex", color: "#3b82f6" }}>
              <AppIcon type="coins" />
            </span>
            Total Borrowed Debt
          </div>
          <strong className="metric-card-value">
            ${totalDebtUsdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </strong>
          <span className="metric-card-subtext">Active USDC loans</span>
        </div>

        {/* Health Factor */}
        <div className="metric-card">
          <div className="metric-card-label">
            <span style={{ width: "16px", height: "16px", display: "inline-flex", color: portfolioHealth.color }}>
              <AppIcon type={portfolioHealth.status === "safe" ? "shield" : "alert"} />
            </span>
            Health Factor
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <strong style={{ fontSize: "24px", fontWeight: 700, color: portfolioHealth.color }}>
              {totalDebtUsdc > 0 ? portfolioHealth.healthFactor.toFixed(2) : "∞"}
            </strong>
            <span className={`badge-status badge-status-${portfolioHealth.status}`}>
              <span style={{ width: "12px", height: "12px", display: "inline-flex" }}>
                <AppIcon type={portfolioHealth.status === "safe" ? "shield" : "alert"} />
              </span>
              {portfolioHealth.status}
            </span>
          </div>
          <span className="metric-card-subtext">Liquidation threshold: 1.00</span>
        </div>

        {/* Safe Borrow Capacity */}
        <div className="metric-card">
          <div className="metric-card-label">
            <span style={{ width: "16px", height: "16px", display: "inline-flex", color: "var(--accent)" }}>
              <AppIcon type="percent" />
            </span>
            Safe Borrow Capacity
          </div>
          <strong className="metric-card-value">
            ${availableBorrowCapacity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </strong>
          <span className="metric-card-subtext">
            Enforcing {effectiveMaxLtvPct.toFixed(1)}% Max LTV limit
          </span>
        </div>
      </div>
    </div>
  );
}
