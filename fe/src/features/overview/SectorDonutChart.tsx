"use client";

import { useState } from "react";
import { formatCompactNumber } from "@/lib/baskets";

export type SectorAllocation = {
  sector: string;
  value: number;
  share: number;
  color: string;
  count: number;
};

interface SectorDonutChartProps {
  allocations: SectorAllocation[];
  totalValue: number;
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  const rawX = centerX + radius * Math.cos(angleInRadians);
  const rawY = centerY + radius * Math.sin(angleInRadians);
  return {
    x: Math.round(rawX * 10000) / 10000,
    y: Math.round(rawY * 10000) / 10000,
  };
}

function describeArc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(x, y, radius, endAngle);
  const end = polarToCartesian(x, y, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    "M", start.x, start.y,
    "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y
  ].join(" ");
}

export function SectorDonutChart({ allocations, totalValue }: SectorDonutChartProps) {
  const [hoveredSector, setHoveredSector] = useState<SectorAllocation | null>(null);

  // Filter strictly to active allocations (held stocks or non-zero value/count)
  const activeHeldAllocations = allocations.filter((a) => a.count > 0 || a.value > 0);

  const cx = 100;
  const cy = 100;
  const radius = 76;
  const strokeWidth = 14;
  const hoverStrokeWidth = 18;

  // Calculate arc angles for held sectors
  const gapDegrees = activeHeldAllocations.length > 1 ? 3 : 0;
  const totalGapDegrees = gapDegrees * activeHeldAllocations.length;
  const availableDegrees = 360 - totalGapDegrees;

  let currentAngle = 0;
  const slices = activeHeldAllocations.map((alloc) => {
    const sliceDegrees = Math.max(0.1, (alloc.share / 100) * availableDegrees);
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceDegrees;
    currentAngle = endAngle + gapDegrees;

    const pathData = sliceDegrees >= 359.9
      ? `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius}`
      : describeArc(cx, cy, radius, startAngle, endAngle);

    return {
      ...alloc,
      startAngle,
      endAngle,
      pathData,
    };
  });

  const activeDisplay = hoveredSector || {
    sector: "Portfolio NAV",
    value: totalValue,
    share: 100,
    color: "var(--accent)",
    count: activeHeldAllocations.reduce((sum, a) => sum + a.count, 0),
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 28px",
        background: "var(--surface-1)",
        border: "1px solid var(--line)",
        borderRadius: "20px",
        gap: "24px",
      }}
    >
      {/* Header */}
      <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 style={{ fontSize: "16px", fontWeight: 700, color: "var(--ink)", margin: 0, letterSpacing: "-0.2px" }}>
            Sector Allocation
          </h3>
          <p style={{ fontSize: "12px", color: "var(--ink-3)", margin: "2px 0 0 0" }}>
            Category exposures across all portfolio assets.
          </p>
        </div>
      </div>

      {/* SVG Hollow Ring Donut */}
      <div
        style={{
          position: "relative",
          width: "200px",
          height: "200px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="200"
          height="200"
          viewBox="0 0 200 200"
          style={{ overflow: "visible" }}
        >
          {/* Base track ring */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="rgba(255, 255, 255, 0.06)"
            strokeWidth={strokeWidth}
          />

          {slices.map((slice) => {
            const isHovered = hoveredSector?.sector === slice.sector;
            return (
              <path
                key={slice.sector}
                d={slice.pathData}
                fill="none"
                stroke={slice.color}
                strokeWidth={isHovered ? hoverStrokeWidth : strokeWidth}
                strokeLinecap="round"
                style={{
                  transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                  cursor: "pointer",
                  filter: isHovered ? `drop-shadow(0 0 8px ${slice.color}A0)` : "none",
                  opacity: hoveredSector && !isHovered ? 0.4 : 1,
                }}
                onMouseEnter={() => setHoveredSector(slice)}
                onMouseLeave={() => setHoveredSector(null)}
              />
            );
          })}
        </svg>

        {/* Center NAV Readout */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
            width: "120px",
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "2px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "115px",
            }}
          >
            {hoveredSector ? hoveredSector.sector : "Total Value"}
          </span>
          <strong
            style={{
              fontSize: "20px",
              fontWeight: 800,
              color: "var(--ink)",
              fontFamily: "monospace",
              lineHeight: 1.1,
            }}
          >
            ${formatCompactNumber(activeDisplay.value)}
          </strong>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: hoveredSector ? hoveredSector.color : "var(--accent)",
              marginTop: "4px",
              background: "rgba(255, 255, 255, 0.08)",
              padding: "2px 8px",
              borderRadius: "12px",
            }}
          >
            {activeDisplay.share.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Interactive Legend with Badges & Dollar Exposures */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "10px",
          width: "100%",
        }}
      >
        {activeHeldAllocations.length > 0 ? (
          activeHeldAllocations.map((item) => {
            const isHovered = hoveredSector?.sector === item.sector;
            return (
              <div
                key={item.sector}
                onMouseEnter={() => setHoveredSector(item)}
                onMouseLeave={() => setHoveredSector(null)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 14px",
                  borderRadius: "9999px",
                  background: isHovered ? "rgba(255, 255, 255, 0.1)" : "rgba(255, 255, 255, 0.04)",
                  border: isHovered ? `1px solid ${item.color}80` : "1px solid rgba(255, 255, 255, 0.06)",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  fontSize: "12px",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: item.color,
                    boxShadow: isHovered ? `0 0 6px ${item.color}` : "none",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontWeight: 600, color: "var(--ink)" }}>{item.sector}</span>
                <span style={{ color: "var(--ink-2)", fontFamily: "monospace", fontSize: "11px", fontWeight: 700 }}>
                  ${formatCompactNumber(item.value)}
                </span>
                <span style={{ color: "var(--ink-3)", fontFamily: "monospace", fontSize: "11px", fontWeight: 600 }}>
                  ({item.share.toFixed(1)}%)
                </span>
              </div>
            );
          })
        ) : (
          <span style={{ fontSize: "12px", color: "var(--ink-3)", fontStyle: "italic" }}>
            No active sector holdings
          </span>
        )}
      </div>
    </div>
  );
}
