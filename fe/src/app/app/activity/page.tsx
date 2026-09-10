"use client";

import { useAccount } from "wagmi";
import { useAllActivity } from "@/hooks/useBaskets";
import { formatAddress, formatEventLabel, formatEventMetadata, getExplorerTxUrl } from "@/lib/baskets";

export default function ActivityPage() {
  const { address, isConnected } = useAccount();
  const { data: activityRes, isLoading } = useAllActivity(31337);
  const rawEvents = (!isConnected || !address) ? [] : (activityRes?.data || []);
  const events = rawEvents.filter((evt, idx, self) => {
    const normHash = (evt.tx_hash || "").toLowerCase();
    const normType = (evt.event_type || "").toLowerCase();
    const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
    return idx === self.findIndex((other) => {
      const otherHash = (other.tx_hash || "").toLowerCase();
      const otherType = (other.event_type || "").toLowerCase();
      if (normHash && normHash !== zeroHash && normHash === otherHash && normType === otherType) {
        return true;
      }
      if (
        normType === otherType &&
        (evt.basket_address || "").toLowerCase() === (other.basket_address || "").toLowerCase() &&
        evt.block_number === other.block_number
      ) {
        return true;
      }
      return false;
    });
  });

  return (
    <div style={{ padding: "32px 40px", maxWidth: "1200px", margin: "0 auto" }}>
      <header style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 700, letterSpacing: "-0.5px", marginBottom: "8px" }}>
          Activity Log
        </h1>
        <p style={{ color: "var(--ink-3)", fontSize: "14px" }}>
          Live indexed smart contract transactions across your baskets.
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
            events.map((evt, idx) => {
              const meta = formatEventMetadata(evt);
              return (
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
                      {formatEventLabel(evt.event_type)}
                    </strong>
                    <small style={{ color: "var(--ink-3)", fontSize: "12px" }}>
                      Safe: {formatAddress(evt.basket_address)} | Actor: {formatAddress(evt.actor_address || "0x000")}
                    </small>
                  </div>

                  <span className="activity-amount" style={{ textAlign: "right", paddingRight: "16px" }}>
                    {meta.amountText && (
                      <strong style={{
                        display: "block",
                        fontSize: "13px",
                        fontWeight: 700,
                        color: meta.isPositive === true ? "#10b981" : meta.isPositive === false ? "#ef4444" : "var(--ink)",
                      }}>
                        {meta.amountText}
                      </strong>
                    )}
                    {getExplorerTxUrl(evt.tx_hash, 31337) !== "#" ? (
                      <a
                        href={getExplorerTxUrl(evt.tx_hash, 31337)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontFamily: "monospace",
                          fontSize: "11px",
                          color: "var(--muted-ink)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          textDecoration: "none",
                        }}
                      >
                        {formatAddress(evt.tx_hash)}
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                          <polyline points="15 3 21 3 21 9"></polyline>
                          <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                      </a>
                    ) : (
                      <span style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--muted-ink)" }}>
                        {formatAddress(evt.tx_hash)} (Anvil)
                      </span>
                    )}
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
              );
            })
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
