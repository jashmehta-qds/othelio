"use client";

import { useAccount, useChainId } from "wagmi";
import { useAllActivity, useBasketsList } from "@/hooks/useBaskets";
import { ActivityEventRow } from "@/features/baskets/ActivityEventRow";
import { useWalletRestoring } from "@/hooks/useWalletRestoring";

export default function ActivityPage() {
  const defaultChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 31337);
  const chainId = useChainId() || defaultChainId;
  const { address, isConnected } = useAccount();
  const isWalletRestoring = useWalletRestoring();
  const { data: activityRes, isLoading } = useAllActivity(chainId, Boolean(isConnected && address));
  const { data: basketsRes } = useBasketsList(chainId, isConnected ? address : undefined);
  const rawEvents = !isConnected || !address ? [] : activityRes?.data ?? [];
  const basketSymbols = new Map<string, string>(
    (basketsRes?.data ?? []).map((basket): [string, string] => [basket.address.toLowerCase(), basket.symbol]),
  );
  const events = rawEvents.filter((event, index, all) => {
    const hash = (event.txHash || "").toLowerCase();
    const type = (event.eventType || "").toLowerCase();
    return index === all.findIndex((other) => {
      const sameHashAndType = hash.length > 0 && hash === (other.txHash || "").toLowerCase() && type === (other.eventType || "").toLowerCase();
      const sameIndexedLog = type === (other.eventType || "").toLowerCase()
        && (event.basketAddress || "").toLowerCase() === (other.basketAddress || "").toLowerCase()
        && event.blockNumber === other.blockNumber && event.logIndex === other.logIndex;
      return sameHashAndType || sameIndexedLog;
    });
  });

  return <div className="app-page-frame activity-page">
    <header><h1 className="page-title">Activity log</h1><p className="page-description">Confirmed onchain operations across your baskets.</p></header>
    <section className="activity-page-list" aria-label="Confirmed basket activity">
      {isWalletRestoring || isLoading ? <p className="activity-empty">{isWalletRestoring ? "Restoring your wallet…" : "Loading confirmed operations…"}</p> : events.length > 0 ? events.map((event, index) => (
        <ActivityEventRow
          key={`${event.txHash}-${event.logIndex ?? index}`}
          event={event}
          basketSymbol={basketSymbols.get(event.basketAddress?.toLowerCase() ?? "")}
          olderEvents={events.slice(index + 1)}
          full
        />
      )) : <p className="activity-empty">No confirmed operations found.</p>}
    </section>
  </div>;
}
