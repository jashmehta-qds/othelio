export interface CanonicalValuationSnapshot {
  total_nav_usdc?: unknown;
  valuation_status?: string;
}

/** Returns a usable end-of-block oracle-marked spot NAV, never an event estimate. */
export function canonicalSpotNav(snapshot: CanonicalValuationSnapshot | null | undefined): number | null {
  if (
    !snapshot
    || snapshot.valuation_status !== 'COMPLETE'
  ) return null;

  const nav = Number(snapshot.total_nav_usdc);
  return Number.isFinite(nav) && nav >= 0 ? nav : null;
}
