"use client";

import React, { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useQuery as useReactQuery } from "@tanstack/react-query";
import { ZERO_EX_LIMIT_ORDER_ABI, toZeroExAbiOrder } from "@othelio/shared";
import { formatUnits } from "viem";
import styles from "./RiskSplitMarkets.module.css";

interface MyOrdersProps {
  seriesAddress?: string;
  claimDecimals: number | null;
}

interface RiskSplitOrderRecord {
  orderHash: string;
  seriesAddress: string;
  claimType: string;
  side: "BUY" | "SELL";
  priceFormatted: string;
  remainingTakerAmount: string;
  remainingMakerAmount: string;
  orderStatus: string;
  isLocallyHidden?: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

export function MyOrders({ seriesAddress, claimDecimals }: MyOrdersProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [cancellingHash, setCancellingHash] = useState<string | null>(null);

  const { data: orders = [], refetch, isLoading, isError } = useReactQuery<RiskSplitOrderRecord[]>({
    queryKey: ["my-orders", address],
    queryFn: async () => {
      if (!address) return [];
      const res = await fetch(`${API_BASE}/v1/orders?owner=${address}`);
      if (!res.ok) throw new Error(`Could not load orders (${res.status})`);
      return res.json();
    },
    enabled: Boolean(address),
    retry: false,
    refetchInterval: (current) => current.state.error ? 30_000 : 8_000,
  });

  const activeOrders = orders.filter((o) => {
    if (seriesAddress && o.seriesAddress.toLowerCase() !== seriesAddress.toLowerCase()) {
      return false;
    }
    const remaining = o.side === "BUY" ? o.remainingTakerAmount : o.remainingMakerAmount;
    return o.orderStatus === "FILLABLE" && !o.isLocallyHidden && BigInt(remaining || "0") > BigInt(0);
  });

  const handleCancel = async (order: RiskSplitOrderRecord) => {
    if (!address) return;
    setCancellingHash(order.orderHash);

    try {
      if (!publicClient) throw new Error("Wallet RPC is unavailable");
      const intentRes = await fetch(`${API_BASE}/v1/orders/${order.orderHash}/cancel-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: address }),
      });

      if (!intentRes.ok) {
        throw new Error("Failed to register cancel intent");
      }

      const intentData = await intentRes.json();

      if (intentData.cancelTx) {
        const hash = await writeContractAsync({
          address: intentData.cancelTx.target as `0x${string}`,
          abi: ZERO_EX_LIMIT_ORDER_ABI,
          functionName: "cancelLimitOrder",
          args: [toZeroExAbiOrder(intentData.cancelTx.args[0])],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Order cancellation reverted");
      }

      refetch();
    } catch (err: unknown) {
      alert(`Cancel failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setCancellingHash(null);
    }
  };

  return (
    <div className={styles.myOrdersWrapper}>
      <div className={styles.myOrdersHead}>
        <h3>Open orders{activeOrders.length > 0 ? ` (${activeOrders.length})` : ""}</h3>
        {address && <button type="button" onClick={() => void refetch()} className={styles.refreshOrdersBtn}>Refresh</button>}
      </div>

      {!address ? (
        <div className={styles.myOrdersEmpty}>Connect a wallet to see your orders for this market.</div>
      ) : isLoading || claimDecimals === null ? (
        <div className={styles.myOrdersEmpty} role="status" aria-label="Loading open orders"><span className={styles.numberSkeleton} /> <span className={styles.numberSkeletonShort} /></div>
      ) : isError ? (
        <div className={styles.myOrdersEmpty}>Open orders are unavailable. <button type="button" onClick={() => void refetch()} className={styles.refreshOrdersBtn}>Try again</button></div>
      ) : activeOrders.length === 0 ? (
        <div className={styles.myOrdersEmpty}>No open limit orders for this market. Choose Limit in the trade ticket to set a price.</div>
      ) : (
        <div className={styles.myOrdersList}>
          {activeOrders.map((ord) => {
              const remClaims =
                ord.side === "BUY"
                  ? Number(formatUnits(BigInt(ord.remainingTakerAmount), claimDecimals)).toFixed(4)
                  : Number(formatUnits(BigInt(ord.remainingMakerAmount), claimDecimals)).toFixed(4);
              const displayedRemainder = Number(remClaims) === 0 ? "<0.0001" : remClaims;

              return (
                <div key={ord.orderHash} className={styles.myOrderRow}>
                  <div className={styles.myOrderTop}>
                    <span className={ord.side === "BUY" ? styles.bidPriceText : styles.askPriceText}>{ord.side} {ord.claimType}</span>
                    <strong>{ord.priceFormatted} <small>/ claim</small></strong>
                  </div>
                  <div className={styles.myOrderBottom}>
                    <span>{displayedRemainder} claims remaining</span>
                    <button
                      type="button"
                      onClick={() => void handleCancel(ord)}
                      disabled={cancellingHash === ord.orderHash}
                      className={styles.cancelOrderBtn}
                      aria-label={`Cancel ${ord.side.toLowerCase()} ${ord.claimType.toLowerCase()} order at ${ord.priceFormatted}`}
                    >
                      {cancellingHash === ord.orderHash ? "Cancelling…" : "Cancel"}
                    </button>
                  </div>
                </div>
              );
          })}
        </div>
      )}
    </div>
  );
}
