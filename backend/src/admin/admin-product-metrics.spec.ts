import { describe, expect, it, vi } from 'vitest';
import { getIndexedProductMetrics, getIndexedSeriesMetrics, valueIndexedCollateral } from './admin-product-metrics';
import { DatabaseService } from '../database/database.service';

const now = Date.parse('2026-11-20T20:00:00Z');
const feed = '0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c';
const row = {
  series_address: '0x1111111111111111111111111111111111111111',
  underlying_address: '0xb200000000000000000000ab99cfa739e253872b',
  expected_feed: feed, price_feed: feed, price: '50000000000',
  feed_updated_at: new Date(now - 1000),
  collateral_raw: '200000000', missing_redemptions: 0, holders: 2,
  first_claim: '100000000', second_claim: '200000000',
};

describe('indexed product metrics', () => {
  it('values remaining collateral rather than the sum of claims, using integer precision', () => {
    expect(valueIndexedCollateral(row, now)).toEqual({ collateral: 200000000n, usdE8: 100000000000n, issue: null });
  });

  it('accepts verified decimals for an additional asset and refuses unknown units', () => {
    const extra = { ...row, underlying_address: '0xb200000000000000000000000000000000000999', collateral_raw: '3000000' };
    expect(valueIndexedCollateral(extra, now).usdE8).toBeNull();
    expect(valueIndexedCollateral(extra, now, 6).usdE8).toBe(150000000000n);
  });

  it.each([
    { price_feed: '0x2222222222222222222222222222222222222222' },
    { feed_updated_at: new Date(now - 25 * 60 * 60 * 1000) },
    { feed_updated_at: new Date(now + 1000) },
    { missing_redemptions: 1 },
    { collateral_raw: '-1' },
  ])('withholds valuation when indexed data is not usable (%o)', (patch) => {
    expect(valueIndexedCollateral({ ...row, ...patch }, now).usdE8).toBeNull();
  });

  it('needs no quote for zero remaining collateral', () => {
    expect(valueIndexedCollateral({ ...row, collateral_raw: '0', price: null }, now).usdE8).toBe(0n);
  });

  it('keeps indexed holders and balances when the event cursor is stale', async () => {
    const db = { query: vi.fn().mockImplementation(async (sql: string) => ({ rows:
      sql.includes('indexer_worker_state') ? [{ current: false }] : [row] })) };
    const result = await getIndexedSeriesMetrics(db as unknown as DatabaseService, 8453, 'Risk Split');
    expect(result.get(row.series_address)).toMatchObject({
      holderWallets: 2, collateralRaw: '200000000', firstClaimBalanceRaw: '100000000', tvlUsd: null,
      valuationIssue: expect.stringContaining('indexer'),
    });
  });

  it('does not show a partial product total as TVL and isolates database errors by product', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const db = { query: vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('basket_nav_observations')) throw new Error('Unreachable');
      if (sql.includes('indexer_worker_state')) return { rows: [{ current: true }] };
      if (sql.includes('COUNT(DISTINCT user_address)')) return { rows: [{ wallets: 7 }] };
      return { rows: sql.includes('risk_split_events') ? [row] : [row, { ...row, price: null }] };
    }) };
    try {
      expect(await getIndexedProductMetrics(db as unknown as DatabaseService, 8453)).toEqual([
        { product: 'Baskets', indexedWallets: null, tvlUsd: null, valuationIssue: 'Indexed data unavailable.' },
        { product: 'Risk Split', indexedWallets: 7, tvlUsd: '1000', valuationIssue: null },
        { product: 'Upside', indexedWallets: 7, tvlUsd: null, valuationIssue: expect.stringContaining('1 indexed market') },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
