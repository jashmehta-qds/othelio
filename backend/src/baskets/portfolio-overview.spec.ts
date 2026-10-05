import { afterEach, describe, expect, it, vi } from 'vitest';
import { BasketsService } from './baskets.service';

const owner = '0x1111111111111111111111111111111111111111';
const asset = '0x2222222222222222222222222222222222222222';
const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
function row(overrides: Record<string, unknown> = {}) {
  return {
    chain_id: 8453, address: owner, controller: owner, name: 'Basket', symbol: 'OTH',
    created_at: '2026-10-05T12:00:00Z', asset_address: asset, decimals: 8,
    quantity_base_units: '100000000', price_usd_e8: '1200000000',
    basis_quantity_base_units: '100000000', open_basis_usdc_micro: '10000000',
    accounting_status: 'COMPLETE', ...overrides,
  };
}
function serviceFor(rows: ReturnType<typeof row>[]) {
  const db = { query: vi.fn().mockResolvedValue({ rows }) };
  return { service: new BasketsService(db as never, {} as never, {} as never), db };
}
afterEach(() => vi.useRealTimers());

describe('portfolio overview accounting', () => {
  it('sums exact remaining basis across baskets and weights average cost by quantity', async () => {
    // Three units worth $36, bought for $32: $4 gain; average cost $10.666666.
    const { service } = serviceFor([row(), row({
      address: '0x3333333333333333333333333333333333333333', quantity_base_units: '200000000',
      basis_quantity_base_units: '200000000', open_basis_usdc_micro: '22000000',
    })]);
    const overview = await service.getPortfolioOverview('8453', owner);
    expect(overview.holdings[0]).toMatchObject({
      quantityBaseUnits: '300000000', valueUsdcMicro: '36000000',
      averageCostUsdcMicroPerBaseUnit: '10666666', unrealizedPnlUsdcMicro: '4000000', status: 'COMPLETE',
    });
  });

  it.each([
    { accounting_status: null, open_basis_usdc_micro: null, basis_quantity_base_units: null },
    { accounting_status: 'INCOMPLETE' },
    { basis_quantity_base_units: '90000000' },
  ])('preserves unknown accounting when one basket has missing or mismatched basis: %j', async (overrides) => {
    const { service } = serviceFor([row(), row({ ...overrides, address: '0x3333333333333333333333333333333333333333' })]);
    const overview = await service.getPortfolioOverview('8453', owner);
    expect(overview.holdings[0]).toMatchObject({
      valueUsdcMicro: '24000000', averageCostUsdcMicroPerBaseUnit: null,
      unrealizedPnlUsdcMicro: null, status: 'PARTIAL',
    });
  });

  it('reports losses and retains zero-cost acquisitions without substituting current value', async () => {
    const loss = serviceFor([row({ open_basis_usdc_micro: '15000000' })]);
    expect((await loss.service.getPortfolioOverview('8453', owner)).holdings[0].unrealizedPnlUsdcMicro).toBe('-3000000');
    const free = serviceFor([row({ open_basis_usdc_micro: '0' })]);
    expect((await free.service.getPortfolioOverview('8453', owner)).holdings[0].unrealizedPnlUsdcMicro).toBe('12000000');
  });

  it('excludes USDC cash from investment P&L without requiring acquisition records', async () => {
    const { service } = serviceFor([row({ asset_address: usdc, decimals: 6, quantity_base_units: '5000000', price_usd_e8: '100000000', accounting_status: null, open_basis_usdc_micro: null })]);
    expect((await service.getPortfolioOverview('8453', owner)).holdings[0]).toMatchObject({
      valueUsdcMicro: '5000000', unrealizedPnlUsdcMicro: '0', status: 'COMPLETE',
    });
  });

  it('does not turn an unavailable price into a gain or loss', async () => {
    const { service } = serviceFor([row({ price_usd_e8: null })]);
    const overview = await service.getPortfolioOverview('8453', owner);
    expect(overview.totalNavUsdcMicro).toBeNull();
    expect(overview.holdings[0]).toMatchObject({
      valueUsdcMicro: null, unrealizedPnlUsdcMicro: null, status: 'UNAVAILABLE',
    });
  });

  it('recomputes unrealized P&L when the price changes after cache expiry', async () => {
    vi.useFakeTimers();
    const { service, db } = serviceFor([row()]);
    expect((await service.getPortfolioOverview('8453', owner)).holdings[0].unrealizedPnlUsdcMicro).toBe('2000000');
    db.query.mockResolvedValue({ rows: [row({ price_usd_e8: '1300000000' })] });
    vi.advanceTimersByTime(15001);
    expect((await service.getPortfolioOverview('8453', owner)).holdings[0].unrealizedPnlUsdcMicro).toBe('3000000');
  });
});
