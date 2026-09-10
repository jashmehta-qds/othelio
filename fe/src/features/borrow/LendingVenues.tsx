"use client";

import { useEffect, useState } from "react";
import { useChainId } from "wagmi";
import { AppIcon } from "@/components/app-shell/AppIcon";
import { LendingVenueQuote, fetchLiveLendingVenues } from "@/lib/lending";

export function LendingVenues() {
  const chainId = useChainId();
  const [venues, setVenues] = useState<LendingVenueQuote[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    fetchLiveLendingVenues(chainId || 31337)
      .then((data) => {
        if (isMounted) {
          setVenues(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [chainId]);

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "16px",
        padding: "20px",
        marginBottom: "28px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
        <h2
          style={{
            fontSize: "15px",
            fontWeight: 700,
            margin: 0,
            color: "var(--ink)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span style={{ width: "18px", height: "18px", display: "inline-flex", color: "var(--accent)" }}>
            <AppIcon type="borrow" />
          </span>
          Live Lending Venue Rates (Base Mainnet)
        </h2>
        <span style={{ fontSize: "11px", color: "var(--muted-ink)" }}>
          {loading ? "Fetching On-Chain Rates..." : "Updated Real-Time via On-Chain Adapters"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
        {venues.map((v) => (
          <div key={v.providerName} className={`rate-card ${v.isRecommended ? "rate-card-recommended" : ""}`}>
            {v.isRecommended && (
              <span
                style={{
                  position: "absolute",
                  top: "-10px",
                  right: "12px",
                  background: "#d7ff46",
                  color: "#10110f",
                  fontSize: "9px",
                  fontWeight: 800,
                  padding: "1px 6px",
                  borderRadius: "4px",
                }}
              >
                BEST RATE
              </span>
            )}
            <strong style={{ fontSize: "13px", color: "var(--ink)", display: "block" }}>{v.providerName}</strong>
            <div style={{ marginTop: "6px", display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
              <span style={{ color: "var(--muted-ink)" }}>Borrow APY:</span>
              <strong style={{ color: v.isRecommended ? "#d7ff46" : "var(--ink)" }}>{v.borrowApyPct.toFixed(2)}%</strong>
            </div>
            <div style={{ marginTop: "4px", display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--muted-ink)" }}>
              <span>Supply APY:</span>
              <span style={{ color: "var(--ink)", fontWeight: 600 }}>{v.supplyApyPct.toFixed(2)}%</span>
            </div>
            <div style={{ marginTop: "4px", display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--muted-ink)" }}>
              <span>Liquidation LTV:</span>
              <span>{v.liquidationThresholdPct.toFixed(1)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
