"use client";

import { useAccount } from "wagmi";
import { useAllActivity } from "@/hooks/useBaskets";
import { ActivityEventRow } from "@/features/baskets/ActivityEventRow";

export default function ActivityPage() {
  const { address, isConnected } = useAccount();
  const { data: activityRes, isLoading } = useAllActivity(31337);
  const rawEvents = !isConnected || !address ? [] : activityRes?.data ?? [];
  const events = rawEvents.filter((event, index, all) => {
    const hash = (event.tx_hash || "").toLowerCase();
    const type = (event.event_type || "").toLowerCase();
    return index === all.findIndex((other) => {
      const sameHashAndType = hash.length > 0 && hash === (other.tx_hash || "").toLowerCase() && type === (other.event_type || "").toLowerCase();
      const sameIndexedLog = type === (other.event_type || "").toLowerCase()
        && (event.basket_address || "").toLowerCase() === (other.basket_address || "").toLowerCase()
        && event.block_number === other.block_number && event.log_index === other.log_index;
      return sameHashAndType || sameIndexedLog;
    });
  });

  return <div className="activity-page">
    <header><h1>Activity log</h1><p>Confirmed onchain operations across your baskets. Select an operation to inspect its asset movements.</p></header>
    <section className="activity-page-list" aria-label="Confirmed basket activity">
      {isLoading ? <p className="activity-empty">Loading confirmed operations…</p> : events.length > 0 ? events.map((event, index) => (
        <ActivityEventRow key={`${event.tx_hash}-${event.log_index ?? index}`} event={event} olderEvents={events.slice(index + 1)} full />
      )) : <p className="activity-empty">No confirmed operations found.</p>}
    </section>
  </div>;
}
