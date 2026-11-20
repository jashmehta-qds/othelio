import type { AdminSeriesMetric } from '@othelio/shared';

export function SeriesMetrics({ metrics, claims }: { metrics?: AdminSeriesMetric | null; claims: [string, string] }) {
  if (!metrics) return <span className="text-zinc-500">Indexed metrics unavailable</span>;
  return (
    <div className="space-y-1 text-xs text-zinc-400">
      <div>{metrics.holderWallets.toLocaleString()} indexed holder wallets</div>
      <div>{metrics.tvlUsd === null ? 'TVL unavailable' : `TVL $${Number(metrics.tvlUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</div>
      {metrics.valuationIssue && <div className="text-amber-400">{metrics.valuationIssue}</div>}
      <div>Raw base units — collateral {metrics.collateralRaw ?? 'unavailable'}; {claims[0]} {metrics.firstClaimBalanceRaw}; {claims[1]} {metrics.secondClaimBalanceRaw}</div>
    </div>
  );
}
