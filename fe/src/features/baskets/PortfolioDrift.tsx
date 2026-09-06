"use client";

import React from "react";
import { Holding } from "@/lib/baskets";

interface PortfolioDriftProps {
  holdings: Holding[];
  onRebalance?: () => void;
}

export function PortfolioDrift({ holdings, onRebalance }: PortfolioDriftProps) {
  const items = holdings.map((h) => {
    const drift = h.current - h.target;
    return { ...h, drift, absDrift: Math.abs(drift) };
  });

  const totalDrift = items.reduce((acc, item) => acc + item.absDrift, 0) / 2;
  const maxDriftItem = [...items].sort((a, b) => b.absDrift - a.absDrift)[0];
  const maxSingleDrift = maxDriftItem ? maxDriftItem.absDrift : 0;

  const highDriftItems = items.filter((i) => i.absDrift > 20);
  const warningDriftItems = items.filter((i) => i.absDrift >= 5);

  let statusText = "Healthy";
  let statusColor = "#10b981";
  let statusBg = "rgba(16, 185, 129, 0.12)";
  let statusBorder = "rgba(16, 185, 129, 0.3)";

  if (highDriftItems.length >= 1) {
    statusText = "High Drift";
    statusColor = "#ef4444";
    statusBg = "rgba(239, 68, 68, 0.12)";
    statusBorder = "rgba(239, 68, 68, 0.3)";
  } else if (warningDriftItems.length >= 1) {
    statusText = "Warning";
    statusColor = "#f59e0b";
    statusBg = "rgba(245, 158, 11, 0.12)";
    statusBorder = "rgba(245, 158, 11, 0.3)";
  }

  // Smooth position mapping along gradient line (0% to 100%)
  let indicatorPercent = 0;
  if (maxSingleDrift <= 5) {
    indicatorPercent = (maxSingleDrift / 5) * 33.33;
  } else if (maxSingleDrift <= 20) {
    indicatorPercent = 33.33 + ((maxSingleDrift - 5) / 15) * 33.33;
  } else {
    indicatorPercent = 66.66 + Math.min(33.34, ((maxSingleDrift - 20) / 15) * 33.34);
  }

  return (
    <section
      style={{
        position: "relative",
        margin: 0,
        padding: "16px 16px 14px",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "12px",
      }}
    >
      {/* Top Border Notched Label "Drift" */}
      <div
        style={{
          position: "absolute",
          top: "-9px",
          left: "14px",
          background: "var(--panel)",
          padding: "0 6px",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--muted-ink)",
          lineHeight: "1",
        }}
      >
        Allocation Drift
      </div>
      {/* Continuous Fluid Gradient Bar & Scale Labels */}
      <div style={{ position: "relative", paddingTop: "8px", paddingBottom: "2px" }}>
        {/* Continuous Gradient Track */}
        <div
          style={{
            position: "relative",
            height: "8px",
            borderRadius: "4px",
            background: "linear-gradient(90deg, #10b981 0%, #34d399 30%, #f59e0b 60%, #ef4444 100%)",
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.3)",
          }}
        >
          {/* Subtle Zone Dividers */}
          <div style={{ position: "absolute", left: "33.33%", top: 0, bottom: 0, width: "1px", background: "rgba(0,0,0,0.2)" }} />
          <div style={{ position: "absolute", left: "66.66%", top: 0, bottom: 0, width: "1px", background: "rgba(0,0,0,0.2)" }} />

          {/* Down-pointing Pointer Arrow Icon Above Track */}
          <div
            style={{
              position: "absolute",
              top: "-16px",
              left: `${indicatorPercent}%`,
              transform: "translateX(-50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              zIndex: 10,
              transition: "left 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill={statusColor}
              stroke="#ffffff"
              strokeWidth="2"
              style={{
                filter: `drop-shadow(0 2px 4px ${statusColor})`,
              }}
            >
              <path d="M12 21l-8-12h16z" />
            </svg>
          </div>
        </div>

        {/* Zone Labels Below Track */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--muted-ink)", fontWeight: 600, marginTop: "8px" }}>
          <span style={{ color: "#10b981" }}>Healthy (&lt;5%)</span>
          <span style={{ color: "#f59e0b" }}>Warning (5–20%)</span>
          <span style={{ color: "#ef4444" }}>Critical (&gt;20%)</span>
        </div>
      </div>
    </section>
  );
}
