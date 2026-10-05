import { describe, expect, it } from 'vitest';
import type { Holding } from '../../../../packages/shared/src/portfolio';
import { summarizeUnrealized } from './portfolio-summary';

const holding: Holding = {
  assetAddress: '0x2222222222222222222222222222222222222222', symbol: 'MSFTc', decimals: 8,
  quantityBaseUnits: '300000000', priceUsdE8: '1200000000', valueUsdcMicro: '36000000',
  averageCostUsdcMicroPerBaseUnit: '10666666', unrealizedPnlUsdcMicro: '4000000',
  currentWeightBps: null, status: 'COMPLETE',
};

describe('portfolio unrealized summary', () => {
  it('uses exact indexed P&L instead of a rounded average cost', () => {
    expect(summarizeUnrealized([holding])).toEqual({ dollars: 4, percent: 12.5 });
  });
  it('excludes cash from the return percentage denominator', () => {
    expect(summarizeUnrealized([holding, { ...holding, symbol: 'USDC', valueUsdcMicro: '100000000', unrealizedPnlUsdcMicro: '0' }])).toEqual({ dollars: 4, percent: 12.5 });
  });
  it.each([
    { unrealizedPnlUsdcMicro: null }, { valueUsdcMicro: null },
  ])('preserves unknown accounting rather than a partial or zero total: %j', (missing) => {
    expect(summarizeUnrealized([holding, { ...holding, ...missing }])).toBeNull();
  });
  it('handles negative returns', () => {
    expect(summarizeUnrealized([{ ...holding, valueUsdcMicro: '24000000', unrealizedPnlUsdcMicro: '-8000000' }])).toEqual({ dollars: -8, percent: -25 });
  });
  it('does not invent an infinite percentage for zero-cost acquisitions', () => {
    expect(summarizeUnrealized([{ ...holding, unrealizedPnlUsdcMicro: '36000000' }])).toEqual({ dollars: 36, percent: null });
  });
  it('represents an empty funded position set as zero gain with no percentage', () => {
    expect(summarizeUnrealized([])).toEqual({ dollars: 0, percent: null });
  });
});
