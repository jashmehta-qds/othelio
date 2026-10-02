"use client";

import { useState } from "react";
import { useWriteContract, useChainId } from "wagmi";
import { parseUnits } from "viem";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { AAVE_V3_BASE_POOL_ADDRESS } from "@/lib/lending";
import { type Basket } from "@/lib/baskets";
import { AAVE_UI_ENABLED, CONTRACT_ADDRESSES, OTHELIO_PORTFOLIO_MODULE_ABI } from "@/lib/contracts";
import { fetchApi } from "@/lib/api";

interface BorrowModalProps {
  basket: Basket & { debtUsdc?: number };
  mode: "borrow" | "repay";
  moduleAddress?: `0x${string}`;
  onClose: () => void;
}

export function BorrowModal({ basket, mode, moduleAddress, onClose }: BorrowModalProps) {
  const chainId = useChainId();
  const activeChainId = chainId && (chainId in CONTRACT_ADDRESSES) ? (chainId as 31337 | 8453) : 31337;

  const [amountInput, setAmountInput] = useState<string>("");
  const { writeContractAsync, isPending, isSuccess, error } = useWriteContract();

  if (!AAVE_UI_ENABLED) {
    return null;
  }

  const handleExecute = async () => {
    if (!amountInput || isNaN(Number(amountInput)) || Number(amountInput) <= 0) return;
    const amountUnits = parseUnits(amountInput, 6);

    const targetModule = moduleAddress || CONTRACT_ADDRESSES[activeChainId].module;
    const usdcAddress = CONTRACT_ADDRESSES[activeChainId].usdc;

    try {
      const txHash = await writeContractAsync({
        address: targetModule,
        abi: OTHELIO_PORTFOLIO_MODULE_ABI,
        functionName: "repayAave",
        args: [
          basket.address as `0x${string}`,
          usdcAddress,
          amountUnits,
        ],
      });

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
      console.error("Borrow/Repay transaction failed:", err);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99,
        background: "rgba(0, 0, 0, 0.75)",
        display: "grid",
        placeItems: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "20px",
          padding: "28px",
          maxWidth: "460px",
          width: "100%",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "var(--ink)" }}>
            {mode === "borrow" ? "Borrow USDC" : "Repay USDC Loan"}
          </h2>
          <button
            onClick={onClose}
            style={{ border: "none", background: "transparent", color: "var(--muted-ink)", cursor: "pointer", fontSize: "20px" }}
          >
            ✕
          </button>
        </div>

        <div style={{ marginBottom: "16px", fontSize: "13px", color: "var(--muted-ink)" }}>
          Target Basket: <strong style={{ color: "var(--ink)" }}>{basket.name}</strong> (${basket.value.toLocaleString()} NAV)
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink-3)", marginBottom: "8px" }}>
            USDC Amount
          </label>
          <input
            type="number"
            placeholder="0.00"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: "12px",
              border: "1px solid var(--line)",
              background: "var(--panel-2)",
              color: "var(--ink)",
              fontSize: "18px",
              fontWeight: 700,
            }}
          />
        </div>

        {error && (
          <div style={{ color: "#ef4444", fontSize: "12px", marginBottom: "16px" }}>
            Transaction failed: {(error as any).shortMessage || error.message}
          </div>
        )}

        {isSuccess && (
          <div style={{ color: "#10b981", fontSize: "12px", marginBottom: "16px" }}>
            Transaction submitted on-chain!
          </div>
        )}

        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: "12px",
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
              padding: "12px",
              borderRadius: "12px",
              border: "none",
              background: "var(--accent)",
              color: "#10110f",
              fontSize: "14px",
              fontWeight: 700,
              cursor: isPending || !amountInput ? "not-allowed" : "pointer",
              opacity: isPending || !amountInput ? 0.6 : 1,
            }}
          >
            {isPending ? "Executing..." : mode === "borrow" ? "Execute Borrow" : "Execute Repay"}
          </button>
        </div>
      </div>
    </div>
  );
}
