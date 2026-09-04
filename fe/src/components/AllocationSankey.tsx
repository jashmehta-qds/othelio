"use client";

import { ResponsiveSankey } from "@nivo/sankey";
import type { CustomSankeyLayerProps } from "@nivo/sankey";

type Allocation = { symbol: string; target: number; current: number; color: string; quantity: number; value: number };

type ChartNode = { id: string; nodeColor: string; symbol: string; side: "target" | "current"; target: number; current: number; quantity: number; dollarValue: number };
type ChartLink = { source: string; target: string; value: number };

function AllocationLabels({ nodes }: CustomSankeyLayerProps<ChartNode, ChartLink>) {
  return <g className="sankey-label-layer">{nodes.map((node) => {
    const isTarget = node.side === "target";
    const x = isTarget ? node.x0 - 16 : node.x1 + 16;
    const y = (node.y0 + node.y1) / 2;
    return <text key={node.id} x={x} y={y - 8} textAnchor={isTarget ? "end" : "start"} className="sankey-label">
      <tspan className="sankey-label-primary">{isTarget ? `${node.symbol}  ${node.target}%` : `${node.current}%`}</tspan>
      <tspan x={x} dy="18" className="sankey-label-secondary">{isTarget ? `${node.quantity.toLocaleString("en-US", { minimumFractionDigits: 2 })} units` : `$${node.dollarValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}</tspan>
    </text>;
  })}</g>;
}

export default function AllocationSankey({ allocations, theme }: { allocations: Allocation[]; theme: "dark" | "light" }) {
  const data = {
    nodes: allocations.flatMap((asset) => [
      { id: `target-${asset.symbol}`, nodeColor: asset.color, symbol: asset.symbol, side: "target" as const, target: asset.target, current: asset.current, quantity: asset.quantity, dollarValue: asset.value },
      { id: `current-${asset.symbol}`, nodeColor: asset.color, symbol: asset.symbol, side: "current" as const, target: asset.target, current: asset.current, quantity: asset.quantity, dollarValue: asset.value },
    ]),
    links: allocations.map((asset) => ({ source: `target-${asset.symbol}`, target: `current-${asset.symbol}`, value: asset.current })),
  };
  return <div className="sankey-wrap" aria-label="Target to current allocation flow chart">
    <div className="sankey-axis"><span>Target allocation</span><span>Current allocation</span></div>
    <ResponsiveSankey
      data={data}
      margin={{ top: 18, right: 120, bottom: 18, left: 140 }}
      align="justify"
      colors={(node) => node.nodeColor as string}
      nodeOpacity={1}
      nodeThickness={10}
      nodeSpacing={26}
      nodeBorderWidth={0}
      linkOpacity={0.82}
      linkHoverOpacity={1}
      linkContract={1}
      enableLinkGradient={false}
      enableLabels={false}
      layers={["links", "nodes", AllocationLabels]}
      animate
      motionConfig="gentle"
      theme={{ tooltip: { container: { background: theme === "dark" ? "#1d1e1b" : "#f8f7f1", color: theme === "dark" ? "#eeeee7" : "#10110f", borderRadius: "10px", boxShadow: "0 10px 35px rgba(0,0,0,.18)", fontSize: "12px" } } }}
    />
  </div>;
}
