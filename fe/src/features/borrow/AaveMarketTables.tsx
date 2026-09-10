"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BasketLogo } from "@/features/baskets/BasketLogo";
import StockLogo from "@/components/StockLogo";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { supportedAssets, type Basket } from "@/lib/baskets";
import { calculateHealthFactor } from "@/lib/lending";

interface AaveMarketTablesProps {
  baskets: (Basket & { collateralUsdc?: number; debtUsdc?: number; isSupplied?: boolean; venue?: string })[];
  totalDebtUsdc: number;
  availableBorrowCapacity: number;
  onOpenActionModal: (basket: Basket & { debtUsdc?: number; collateralUsdc?: number }, mode: "borrow" | "repay" | "supply" | "withdraw") => void;
}

export function AaveMarketTables({
  baskets,
  totalDebtUsdc,
  availableBorrowCapacity,
  onOpenActionModal,
}: AaveMarketTablesProps) {
  const router = useRouter();

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "20px",
        padding: "24px",
        marginBottom: "36px",
      }}
    >
      {/* Section Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div>
          <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "var(--ink)", display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "18px", height: "18px", display: "inline-flex", color: "#10b981" }}>
              <AppIcon type="shield" />
            </span>
            Your Collateral Baskets & Credit Lines
          </h2>
          <p style={{ fontSize: "12px", color: "var(--muted-ink)", margin: "4px 0 0 0" }}>
            Stock basket collateral, money market protocols, loan health factors, and active USDC credit lines
          </p>
        </div>
      </div>

      {/* Single Consolidated Table */}
      <div style={{ overflowX: "auto" }}>
        <table className="borrow-table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 8px" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", paddingBottom: "12px", width: "100%" }}>Basket & Assets</th>
              <th style={{ textAlign: "left", paddingBottom: "12px", whiteSpace: "nowrap", width: "auto" }}>Protocol</th>
              <th style={{ textAlign: "right", paddingBottom: "12px", whiteSpace: "nowrap", width: "auto" }}>Amounts</th>
              <th style={{ textAlign: "right", paddingBottom: "12px", whiteSpace: "nowrap", width: "auto" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {baskets.length > 0 ? (
              baskets.map((b) => {
                const suppliedUsd = b.collateralUsdc || (b.isSupplied ? b.value : 0);
                const debtUsd = b.debtUsdc || 0;
                const hf = calculateHealthFactor(suppliedUsd, debtUsd, 80.0);

                return (
                  <tr
                    key={b.address}
                    onClick={() => router.push(`/app/borrow/${b.address}`)}
                    style={{
                      background: "transparent",
                      borderRadius: "12px",
                      cursor: "pointer",
                      transition: "background 0.15s ease",
                    }}
                  >
                    {/* Col 1: Basket & Assets (2 Rows) */}
                    <td style={{ padding: "14px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <BasketLogo name={b.name} />
                        <div>
                          <strong style={{ fontSize: "14px", display: "block", color: "var(--ink)" }}>{b.name}</strong>
                          <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "4px", flexWrap: "wrap" }}>
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
                                    <StockLogo symbol={sym} size={16} roundedFull />
                                  </span>
                                );
                              })
                            ) : (
                              <span style={{ fontSize: "11px", color: "var(--muted-ink)", fontWeight: 400 }}>Stock Basket</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Col 2: Protocol & Health Factor (2 Rows) */}
                    <td style={{ padding: "14px 16px" }}>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>
                          {b.venue || "Aave v3"}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--muted-ink)", marginTop: "2px" }}>
                          Health: <strong style={{ color: hf.color }}>{debtUsd > 0 ? hf.healthFactor.toFixed(2) : "∞"}</strong>
                        </div>
                      </div>
                    </td>

                    {/* Col 3: Supplied ($) / Borrowed ($) (Right Aligned Numbers with Suffix, 2 Rows) */}
                    <td style={{ padding: "14px 16px", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end" }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
                          <span style={{ fontSize: "13px", fontWeight: 700, color: suppliedUsd > 0 ? "#10b981" : "var(--ink)" }}>
                            ${suppliedUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          <span style={{ fontSize: "11px", color: "var(--muted-ink)", fontWeight: 500, width: "52px", textAlign: "left" }}>
                            supplied
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: "5px", marginTop: "2px" }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: debtUsd > 0 ? "#3b82f6" : "var(--muted-ink)" }}>
                            ${debtUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          <span style={{ fontSize: "11px", color: "var(--muted-ink)", fontWeight: 500, width: "52px", textAlign: "left" }}>
                            borrowed
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Col 4: Actions (Stacked Borrow & Repay Buttons) */}
                    <td style={{ padding: "14px 16px", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: "5px" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenActionModal(b, "borrow");
                          }}
                          style={{
                            width: "72px",
                            padding: "5px 0",
                            borderRadius: "6px",
                            background: "var(--accent)",
                            color: "#10110f",
                            fontSize: "11px",
                            fontWeight: 700,
                            border: "none",
                            cursor: "pointer",
                            textAlign: "center",
                          }}
                        >
                          Borrow
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenActionModal(b, "repay");
                          }}
                          disabled={debtUsd <= 0}
                          style={{
                            width: "72px",
                            padding: "5px 0",
                            borderRadius: "6px",
                            background: "var(--panel-2)",
                            border: "1px solid var(--line)",
                            color: debtUsd > 0 ? "var(--ink)" : "var(--muted-ink)",
                            opacity: debtUsd > 0 ? 1 : 0.4,
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: debtUsd > 0 ? "pointer" : "not-allowed",
                            textAlign: "center",
                          }}
                        >
                          Repay
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4} style={{ padding: "32px", textAlign: "center", color: "var(--muted-ink)" }}>
                  No baskets found. Create or seed a basket to enable collateral borrowing.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
