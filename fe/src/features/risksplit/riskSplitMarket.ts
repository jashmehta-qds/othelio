import type { RiskSplitSeriesData } from "./useRiskSplit";

export type RiskProfile = "all" | "15-25" | "50-50" | "25-10" | "other";

export const RISK_PROFILES: ReadonlyArray<{ key: RiskProfile; label: string; floorBps?: bigint; capBps?: bigint }> = [
  { key: "all", label: "All markets" },
  { key: "15-25", label: "−15% / +25%", floorBps: BigInt(8500), capBps: BigInt(12500) },
  { key: "50-50", label: "−50% / +50%", floorBps: BigInt(5000), capBps: BigInt(15000) },
  { key: "25-10", label: "−25% / +10%", floorBps: BigInt(7500), capBps: BigInt(11000) },
  { key: "other", label: "Other" },
];

export function profileForSeries(series: RiskSplitSeriesData): RiskProfile {
  if (!series.creationReferenceVerified || !series.creationReferencePriceUsdE8 || !series.creationFeedAddress || !series.creationFeedRoundId || !series.creationReferenceBlock) return "other";
  const reference = BigInt(series.creationReferencePriceUsdE8);
  if (reference <= BigInt(0)) return "other";
  const floor = BigInt(series.floorPrice);
  const cap = BigInt(series.capPrice);
  // Allow less than one part per million of integer feed-price rounding.
  const tolerance = reference / BigInt(1_000_000) > BigInt(1) ? reference / BigInt(1_000_000) : BigInt(1);
  for (const profile of RISK_PROFILES) {
    if (!profile.floorBps || !profile.capBps) continue;
    const expectedFloor = reference * profile.floorBps / BigInt(10_000);
    const expectedCap = reference * profile.capBps / BigInt(10_000);
    const floorGap = floor > expectedFloor ? floor - expectedFloor : expectedFloor - floor;
    const capGap = cap > expectedCap ? cap - expectedCap : expectedCap - cap;
    if (floorGap <= tolerance && capGap <= tolerance) return profile.key;
  }
  return "other";
}

export function isOpenSeries(series: RiskSplitSeriesData, nowSeconds: number): boolean {
  return !series.isSettled && series.expiryTimestamp > nowSeconds && /^0x[a-fA-F0-9]{40}$/.test(series.seriesAddress)
    && series.seriesAddress.toLowerCase() !== "0x0000000000000000000000000000000000000000";
}

export function usdFromE8(value: string | null | undefined): string {
  if (!value) return "—";
  const amount = Number(value) / 1e8;
  return Number.isFinite(amount) ? `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}
