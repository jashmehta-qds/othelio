"use client";

import { useAllActivity } from "@/hooks/useBaskets";
import { formatAddress } from "@/lib/baskets";

export default function ActivityPage() {
  const { data: activityRes, isLoading } = useAllActivity(31337);
  const events = activityRes?.data || [];

  return (
    <div style={{ padding: "32px 40px", maxWidth: "1200px", margin: "0 auto" }}>
      <header style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 700, letterSpacing: "-0.5px", marginBottom: "8px" }}>
          Activity Log
        </h1>
        <p style={{ color: "var(--ink-3)", fontSize: "14px" }}>
          Live indexed smart contract transactions across all baskets on Base Local.
        </p>
      </header>

      <div
        className="allocation-block"
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--line)",
          borderRadius: "16px",
          overflow: "hidden",
        }}
      >
        <div className="activity-table">
          {isLoading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--ink-3)" }}>
              Loading activity feed...
            </div>
          ) : events.length > 0 ? (
            events.map((evt, idx) => (
              <div
                key={`${evt.tx_hash}-${idx}`}
                className="activity-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "140px 1fr 180px 110px",
                  alignItems: "center",
                  padding: "16px 24px",
                  borderBottom: "1px solid var(--line)",
                  fontSize: "14px",
                }}
              >
                <span className="activity-time" style={{ color: "var(--ink-3)", fontFamily: "monospace", fontSize: "13px" }}>
                  {evt.block_number ? `Block #${evt.block_number}` : "Pending Index"}
                </span>

                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <strong style={{ fontWeight: 600, color: "var(--ink)" }}>
                    {evt.event_type === "FUNDED" ? "Basket Funded (Mint)" : evt.event_type === "CREATED" ? "Basket Created" : evt.event_type}
                  </strong>
                  <small style={{ color: "var(--ink-3)", fontSize: "12px" }}>
                    Safe: {formatAddress(evt.basket_address)} | Actor: {formatAddress(evt.actor_address || "0x000")}
                  </small>
                </div>

                <span className="activity-amount" style={{ textAlign: "right", paddingRight: "16px" }}>
                  <a
                    href={`https://etherscan.io/tx/${evt.tx_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontFamily: "monospace",
                      fontSize: "12px",
                      color: "var(--accent)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      textDecoration: "none",
                    }}
                  >
                    {formatAddress(evt.tx_hash)}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </a>
                </span>

                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "4px 10px",
                    borderRadius: "20px",
                    fontSize: "12px",
                    fontWeight: 600,
                    background: "rgba(16, 185, 129, 0.1)",
                    color: "#10b981",
                  }}
                >
                  Indexed
                </span>
              </div>
            ))
          ) : (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--ink-3)" }}>
              No indexed transactions found yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
