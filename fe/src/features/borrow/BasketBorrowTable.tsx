"use client";

import Link from "next/link";
import { BasketLogo } from "@/features/baskets/BasketLogo";
import StockLogo from "@/components/StockLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { calculateHealthFactor, type RiskPreference } from "@/lib/lending";
import { supportedAssets, type Basket } from "@/lib/baskets";

interface BasketBorrowTableProps {
  baskets: (Basket & { debtUsdc?: number; venue?: string })[];
  riskPref: RiskPreference;
  onOpenActionModal: (basket: Basket & { debtUsdc?: number }, mode: "borrow" | "repay") => void;
}

export function BasketBorrowTable({ baskets, riskPref, onOpenActionModal }: BasketBorrowTableProps) {
  return (
    <div className="activity-block" style={{ marginTop: 0 }}>
      <div className="section-title">
        <div>
          <h2>Basket Loan Positions</h2>
          <p>Active stock token collateral NAV and loan health factors per basket</p>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="borrow-table">
          <thead>
            <tr>
              <th>Basket</th>
              <th>Collateral NAV</th>
              <th>Current Debt</th>
              <th>Health Factor</th>
              <th>Venue</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {baskets.length > 0 ? (
              baskets.map((b) => {
                const debt = b.debtUsdc || 0;
                const hf = calculateHealthFactor(b.value, debt, 80.0);
                const isSafe = hf.status === "safe";

                return (
                  <tr key={b.address}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <BasketLogo name={b.name} />
                        <div>
                          <strong style={{ fontSize: "14px", display: "block", color: "var(--ink)" }}>{b.name}</strong>
                          <small style={{ color: "var(--accent)", fontFamily: "monospace", fontSize: "11px" }}>
                            {b.ensDomain || `${b.name.toLowerCase().replace(/[^a-z0-9]/g, "")}.othelio.eth`}
                          </small>
                        </div>
                      </div>
                    </td>

                    <td style={{ fontWeight: 600 }}>
                      ${b.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "4px", flexWrap: "wrap" }}>
                        {b.holdings.length > 0 ? (
                          b.holdings.map((h) => {
                            const known = supportedAssets.find((sa) =>
                              sa.symbol.toLowerCase() === h.symbol.toLowerCase() ||
                              (sa.address && h.address && sa.address.toLowerCase() === h.address.toLowerCase()) ||
                              (sa.address && sa.address.toLowerCase() === h.symbol.toLowerCase())
                            );
                            const sym = known?.symbol || h.symbol;
                            return (
                              <span key={h.symbol} title={known?.name || sym} style={{ display: "inline-flex", alignItems: "center" }}>
                                <StockLogo symbol={sym} size={18} roundedFull />
                              </span>
                            );
                          })
                        ) : (
                          <span style={{ fontSize: "11px", color: "var(--muted-ink)", fontWeight: 400 }}>Stock Assets</span>
                        )}
                      </div>
                    </td>

                    <td style={{ fontWeight: 600, color: debt > 0 ? "#3b82f6" : "var(--ink-3)" }}>
                      {debt > 0 ? `$${debt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00"}
                    </td>

                    <td>
                      <span className={`badge-status badge-status-${hf.status}`}>
                        <span style={{ width: "12px", height: "12px", display: "inline-flex" }}>
                          <AppIcon type={isSafe ? "shield" : "alert"} />
                        </span>
                        {debt > 0 ? `${hf.healthFactor.toFixed(2)} (${hf.status.toUpperCase()})` : "∞ (SAFE)"}
                      </span>
                    </td>

                    <td style={{ fontSize: "12px", color: "var(--muted-ink)" }}>Aave v3 (4.20% APY)</td>

                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "8px" }}>
                        <button
                          onClick={() => onOpenActionModal(b, "borrow")}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "8px",
                            background: "var(--accent)",
                            color: "#10110f",
                            fontSize: "12px",
                            fontWeight: 700,
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          Borrow
                        </button>
                        {debt > 0 && (
                          <button
                            onClick={() => onOpenActionModal(b, "repay")}
                            style={{
                              padding: "6px 12px",
                              borderRadius: "8px",
                              background: "var(--panel-2)",
                              border: "1px solid var(--line)",
                              color: "var(--ink)",
                              fontSize: "12px",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            Repay
                          </button>
                        )}
                        <Link
                          href={`/app/baskets/${b.address}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "6px 10px",
                            borderRadius: "8px",
                            background: "var(--panel-2)",
                            border: "1px solid var(--line)",
                            color: "var(--muted-ink)",
                            fontSize: "12px",
                            fontWeight: 600,
                            textDecoration: "none",
                          }}
                        >
                          Details
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} style={{ padding: "24px", textAlign: "center", color: "var(--muted-ink)" }}>
                  No active baskets found. Create or deposit into a basket to borrow against stock collateral.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
