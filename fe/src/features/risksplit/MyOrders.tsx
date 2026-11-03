"use client";

import React, { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { useQuery as useReactQuery } from "@tanstack/react-query";
import { ZERO_EX_EXCHANGE_PROXY_BASE, ZERO_EX_LIMIT_ORDER_ABI } from "@othelio/shared";

interface MyOrdersProps {
  seriesAddress?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

export function MyOrders({ seriesAddress }: MyOrdersProps) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [cancellingHash, setCancellingHash] = useState<string | null>(null);

  const { data: orders = [], refetch } = useReactQuery<any[]>({
    queryKey: ["my-orders", address],
    queryFn: async () => {
      if (!address) return [];
      const res = await fetch(`${API_BASE}/v1/orders?owner=${address}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: Boolean(address),
    refetchInterval: 4000,
  });

  const activeOrders = orders.filter((o) => {
    if (seriesAddress && o.seriesAddress.toLowerCase() !== seriesAddress.toLowerCase()) {
      return false;
    }
    return o.orderStatus === "FILLABLE" && !o.isLocallyHidden;
  });

  const handleCancel = async (order: any) => {
    if (!address) return;
    setCancellingHash(order.orderHash);

    try {
      // 1. Submit cancel intent to hide immediately
      const intentRes = await fetch(`${API_BASE}/v1/orders/${order.orderHash}/cancel-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: address }),
      });

      if (!intentRes.ok) {
        throw new Error("Failed to register cancel intent");
      }

      const intentData = await intentRes.json();

      // 2. Execute onchain cancellation via 0x ExchangeProxy
      if (intentData.cancelTx) {
        await writeContractAsync({
          address: intentData.cancelTx.target as `0x${string}`,
          abi: ZERO_EX_LIMIT_ORDER_ABI,
          functionName: "cancelLimitOrder",
          args: intentData.cancelTx.args,
        });
      }

      refetch();
    } catch (err: any) {
      alert(`Cancel failed: ${err?.message}`);
    } finally {
      setCancellingHash(null);
    }
  };

  if (!address || activeOrders.length === 0) return null;

  return (
    <div className="bg-[#161715] border border-[#292a27] rounded-lg p-5 space-y-3 text-xs font-mono">
      <div className="flex justify-between items-center border-b border-[#292a27] pb-2">
        <h3 className="font-semibold text-white uppercase text-sm">
          Open Limit Orders ({activeOrders.length})
        </h3>
        <button onClick={() => refetch()} className="text-zinc-500 hover:text-white">
          ↻
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[#292a27] text-zinc-500 text-[11px] uppercase">
              <th className="py-2">Side</th>
              <th className="py-2">Claim</th>
              <th className="py-2">Price</th>
              <th className="py-2">Remaining</th>
              <th className="py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1e1f1c] text-zinc-300">
            {activeOrders.map((ord) => {
              const remClaims =
                ord.side === "BUY"
                  ? (Number(ord.remainingTakerAmount) / 1e8).toFixed(4)
                  : (Number(ord.remainingMakerAmount) / 1e8).toFixed(4);

              return (
                <tr key={ord.orderHash} className="hover:bg-[#1a1b18]">
                  <td className="py-2">
                    <span
                      className={`font-semibold ${
                        ord.side === "BUY" ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {ord.side}
                    </span>
                  </td>
                  <td className="py-2 text-zinc-400">{ord.claimType}</td>
                  <td className="py-2 font-semibold text-white">{ord.priceFormatted}</td>
                  <td className="py-2">{remClaims}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => handleCancel(ord)}
                      disabled={cancellingHash === ord.orderHash}
                      className="px-2 py-0.5 rounded bg-[#292a27] hover:bg-red-950/60 hover:text-red-400 text-zinc-400 transition-colors disabled:opacity-50"
                    >
                      {cancellingHash === ord.orderHash ? "Cancelling..." : "Cancel"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
