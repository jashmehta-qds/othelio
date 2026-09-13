"use client";

import { useState, useMemo } from "react";
import { useWriteContract, useChainId } from "wagmi";
import { parseUnits } from "viem";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { AAVE_V3_BASE_POOL_ADDRESS, calculateHealthFactor } from "@/lib/lending";
import { type Basket } from "@/lib/baskets";
import { AAVE_UI_ENABLED, CONTRACT_ADDRESSES, OTHELIO_PORTFOLIO_MODULE_ABI } from "@/lib/contracts";
import { fetchApi } from "@/lib/api";

interface AaveActionModalProps {
  basket: Basket & { debtUsdc?: number };
  initialMode?: "borrow" | "repay" | "supply" | "withdraw";
  moduleAddress?: `0x${string}`;
  onClose: () => void;
}

export function AaveActionModal({ basket, initialMode = "borrow", moduleAddress, onClose }: AaveActionModalProps) {
  const chainId = useChainId();
  const activeChainId = chainId && (chainId in CONTRACT_ADDRESSES) ? (chainId as 31337 | 8453 | 84532) : 31337;

  const [mode, setMode] = useState<"borrow" | "repay" | "supply" | "withdraw">(initialMode);
  const [amountInput, setAmountInput] = useState<string>("");
  const { writeContractAsync, isPending, isSuccess, error } = useWriteContract();

  const currentDebt = basket.debtUsdc || 0;
  const collateralNAV = basket.value || 0;
  const maxBorrowAmount = Math.max(0, collateralNAV * 0.5 - currentDebt); // 50% safe max debt capacity

  // Current Health Factor
  const currentHF = useMemo(() => {
    return calculateHealthFactor(collateralNAV, currentDebt, 80.0);
  }, [collateralNAV, currentDebt]);

  // Health Factor preview after transaction
  const previewHF = useMemo(() => {
    const amountNum = Number(amountInput) || 0;
    let nextDebt = currentDebt;
    let nextCollateral = collateralNAV;

    if (mode === "borrow") {
      nextDebt += amountNum;
    } else if (mode === "repay") {
      nextDebt = Math.max(0, currentDebt - amountNum);
    } else if (mode === "supply") {
      nextCollateral += amountNum;
    } else if (mode === "withdraw") {
      nextCollateral = Math.max(0, collateralNAV - amountNum);
    }

    return calculateHealthFactor(nextCollateral, nextDebt, 80.0);
  }, [mode, amountInput, currentDebt, collateralNAV]);

  if (!AAVE_UI_ENABLED) {
    return null;
  }

  const handleSetPercent = (pct: number) => {
    let base = 0;
    if (mode === "borrow") base = maxBorrowAmount;
    else if (mode === "repay") base = currentDebt;
    else if (mode === "supply") base = collateralNAV;
    else if (mode === "withdraw") base = collateralNAV;

    const calculated = (base * pct) / 100;
    setAmountInput(calculated > 0 ? calculated.toFixed(2) : "");
  };

  const handleExecute = async () => {
    if (!amountInput || isNaN(Number(amountInput)) || Number(amountInput) <= 0) return;
    const amountUnits = parseUnits(amountInput, 6);
    const targetModule = moduleAddress || CONTRACT_ADDRESSES[activeChainId].module;
    const usdcAddress = CONTRACT_ADDRESSES[activeChainId].usdc;

    try {
      let txHash: `0x${string}`;
      if (mode === "withdraw") {
        txHash = await writeContractAsync({
          address: targetModule,
          abi: OTHELIO_PORTFOLIO_MODULE_ABI,
          functionName: "withdrawAaveCollateral",
          args: [basket.address as `0x${string}`, usdcAddress, amountUnits, BigInt("1250000000000000000")],
        });
      } else if (mode === "repay") {
        txHash = await writeContractAsync({
          address: targetModule,
          abi: OTHELIO_PORTFOLIO_MODULE_ABI,
          functionName: "repayAave",
          args: [basket.address as `0x${string}`, usdcAddress, amountUnits],
        });
      } else {
        txHash = await writeContractAsync({
          address: targetModule,
          abi: OTHELIO_PORTFOLIO_MODULE_ABI,
          functionName: "supplyAave",
          args: [basket.address as `0x${string}`, usdcAddress, amountUnits],
        });
      }

      fetchApi("/v1/baskets/lending-event", {
        method: "POST",
        body: JSON.stringify({
          chainId: activeChainId,
          basketAddress: basket.address,
          action: mode.toUpperCase(),
          assetAddress: usdcAddress,
          amount: amountUnits.toString(),
          winningProvider: "Aave v3",
          winningPool: AAVE_V3_BASE_POOL_ADDRESS,
          winningBorrowApy: 4.20,
          txHash,
        }),
      }).catch(() => null);
    } catch (err) {
      console.error("Aave transaction failed:", err);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "grid",
        placeItems: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          background: "#161715",
          border: "1px solid var(--line)",
          borderRadius: "24px",
          padding: "32px",
          maxWidth: "480px",
          width: "100%",
          boxShadow: "0 24px 48px rgba(0, 0, 0, 0.6)",
        }}
      >
        {/* Header & Tabs */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <div style={{ display: "flex", gap: "8px", background: "var(--panel-2)", padding: "4px", borderRadius: "12px" }}>
            <button
              onClick={() => setMode("borrow")}
              style={{
                padding: "6px 14px",
                borderRadius: "8px",
                border: "none",
                background: mode === "borrow" ? "var(--accent)" : "transparent",
                color: mode === "borrow" ? "#10110f" : "var(--muted-ink)",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Borrow
            </button>
            <button
              onClick={() => setMode("repay")}
              style={{
                padding: "6px 14px",
                borderRadius: "8px",
                border: "none",
                background: mode === "repay" ? "var(--accent)" : "transparent",
                color: mode === "repay" ? "#10110f" : "var(--muted-ink)",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Repay
            </button>
            <button
              onClick={() => setMode("supply")}
              style={{
                padding: "6px 14px",
                borderRadius: "8px",
                border: "none",
                background: mode === "supply" ? "var(--accent)" : "transparent",
                color: mode === "supply" ? "#10110f" : "var(--muted-ink)",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Supply
            </button>
          </div>

          <button
            onClick={onClose}
            style={{ border: "none", background: "transparent", color: "var(--muted-ink)", cursor: "pointer", fontSize: "20px" }}
          >
            ✕
          </button>
        </div>

        {/* Selected Position Header */}
        <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "14px 16px", borderRadius: "14px", marginBottom: "20px" }}>
          <div style={{ fontSize: "12px", color: "var(--muted-ink)", marginBottom: "4px" }}>Selected Basket Collateral</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: "15px", color: "var(--ink)" }}>{basket.name}</strong>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--accent)" }}>
              ${collateralNAV.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} NAV
            </span>
          </div>
        </div>

        {/* Input & Sliders */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--muted-ink)" }}>Amount (USDC)</label>
            <span style={{ fontSize: "11px", color: "var(--muted-ink)" }}>
              Max: ${mode === "borrow" ? maxBorrowAmount.toFixed(2) : mode === "repay" ? currentDebt.toFixed(2) : collateralNAV.toFixed(2)}
            </span>
          </div>

          <input
            type="number"
            placeholder="0.00"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            style={{
              width: "100%",
              padding: "14px 18px",
              borderRadius: "14px",
              border: "1px solid var(--line)",
              background: "var(--panel-2)",
              color: "var(--ink)",
              fontSize: "22px",
              fontWeight: 800,
            }}
          />

          {/* Quick % Buttons */}
          <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                onClick={() => handleSetPercent(pct)}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                  background: "var(--panel-2)",
                  color: "var(--ink)",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {pct === 100 ? "MAX" : `${pct}%`}
              </button>
            ))}
          </div>
        </div>

        {/* Health Factor Impact Preview */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.02)",
            border: "1px solid var(--line)",
            borderRadius: "14px",
            padding: "14px 16px",
            marginBottom: "24px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "8px" }}>
            <span style={{ color: "var(--muted-ink)" }}>Health Factor Impact</span>
            <span style={{ fontWeight: 700, color: previewHF.color }}>
              {currentDebt > 0 ? currentHF.healthFactor.toFixed(2) : "∞"} → {previewHF.healthFactor.toFixed(2)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--muted-ink)" }}>
            <span>Liquidation Threshold</span>
            <span>80.0%</span>
          </div>
        </div>

        {error && (
          <div style={{ color: "#ef4444", fontSize: "12px", marginBottom: "16px" }}>
            Transaction failed: {(error as any).shortMessage || error.message}
          </div>
        )}

        {isSuccess && (
          <div style={{ color: "#10b981", fontSize: "12px", marginBottom: "16px" }}>
            Transaction submitted successfully!
          </div>
        )}

        {/* Submit Actions */}
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "14px",
              borderRadius: "14px",
              border: "1px solid var(--line)",
              background: "var(--panel-2)",
              color: "var(--ink)",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleExecute}
            disabled={isPending || !amountInput}
            style={{
              flex: 1.5,
              padding: "14px",
              borderRadius: "14px",
              border: "none",
              background: "var(--accent)",
              color: "#10110f",
              fontSize: "14px",
              fontWeight: 800,
              cursor: isPending || !amountInput ? "not-allowed" : "pointer",
              opacity: isPending || !amountInput ? 0.6 : 1,
            }}
          >
            {isPending ? "Submitting..." : `Execute ${mode.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
