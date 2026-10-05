import type { Holding } from '../../../../packages/shared/src/portfolio';

/** Use exact indexed P&L: rounded average costs lose basis precision. */
export function summarizeUnrealized(holdings: Holding[]): { dollars: number; percent: number | null } | null {
  let pnl = BigInt(0);
  let basis = BigInt(0);
  for (const holding of holdings) {
    if (holding.symbol === 'USDC') continue;
    if (holding.valueUsdcMicro === null || holding.unrealizedPnlUsdcMicro === null) return null;
    const gain = BigInt(holding.unrealizedPnlUsdcMicro);
    pnl += gain;
    basis += BigInt(holding.valueUsdcMicro) - gain;
  }
  return { dollars: Number(pnl) / 1e6, percent: basis > BigInt(0) ? Number(pnl) / Number(basis) * 100 : null };
}
