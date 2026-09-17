import {
  createPortfolioOnlyCapabilities,
  createUnknownDeploymentCapabilities,
  positionSnapshotSchema,
} from '@othelio/shared';
import { describe, expect, it, vi } from 'vitest';
import { BasketsService } from './baskets.service';

const basketAddress = '0x1111111111111111111111111111111111111111';

describe('portfolio foundation contracts', () => {
  it('defaults every new-exposure action off without claiming onchain enforcement', () => {
    const capabilities = createPortfolioOnlyCapabilities(8453, 'portfolio-v1');

    for (const action of ['SUPPLY', 'BORROW', 'REINVEST'] as const) {
      expect(capabilities.actions[action]).toMatchObject({
        availability: 'DISABLED',
        enforcement: { api: false, onchain: false },
      });
    }
    expect(capabilities.authorityMode).toBe('UNRESTRICTED_OWNER');
    expect(capabilities.actions.REPAY.availability).toBe('CONDITIONAL');
  });

  it('fails closed for unknown deployments while retaining conditional recovery', () => {
    const capabilities = createUnknownDeploymentCapabilities(8453);

    expect(capabilities.actions.FUND.availability).toBe('DISABLED');
    expect(capabilities.actions.BORROW.availability).toBe('DISABLED');
    expect(capabilities.actions.REPAY.availability).toBe('CONDITIONAL');
    expect(capabilities.authorityMode).toBe('UNKNOWN');
  });

  it('represents unavailable reads with null amounts instead of zero', () => {
    const snapshot = positionSnapshotSchema.parse({
      chainId: 8453,
      basketAddress,
      blockNumber: 1,
      blockHash: `0x${'1'.repeat(64)}`,
      observedAt: '2026-09-09T12:00:00.000Z',
      tokens: [{
        assetAddress: '0x2222222222222222222222222222222222222222',
        decimals: 6,
        liquidAmountBaseUnits: null,
        priceUsdE8: null,
      }],
      markets: [],
      grossAssetsUsdE8: null,
      accruedDebtUsdE8: null,
      equityUsdE8: null,
      readCompleteness: 'UNAVAILABLE',
      valuationStatus: 'UNAVAILABLE',
    });

    expect(snapshot.tokens[0].liquidAmountBaseUnits).toBeNull();
    expect(snapshot.issues).toEqual([]);
  });
});

describe('BasketsService extraction boundary', () => {
  it('returns weighted-average accounting as exact strings only after controller ownership verification', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
        .mockResolvedValueOnce({ rows: [{
          asset_address: '0x2222222222222222222222222222222222222222',
          quantity_base_units: '2000000000000000000', decimals: 18,
          open_basis_usdc_micro: '300000000', accounting_status: 'COMPLETE', issue: null,
          spot_price_usd_e8: '17500000000', spot_value_usdc_micro: '350000000',
          weighted_average_cost_usdc_micro_per_base_unit: '0.00000000015', unrealised_pnl_usdc_micro: '50000000', updated_at: '2026-09-17T12:00:00.000Z',
        }] }),
    };
    const service = new BasketsService(db as never, {} as never, {} as never);
    const result = await service.getAccountingSummary(basketAddress, '31337', basketAddress);
    expect(result.data.assets[0]).toMatchObject({
      quantityBaseUnits: '2000000000000000000', openBasisUsdcMicro: '300000000',
      spotValueUsdcMicro: '350000000', unrealisedPnlUsdcMicro: '50000000', accountingStatus: 'COMPLETE',
    });
    expect(db.query.mock.calls[1][0]).toContain('asset_cost_basis');
    expect(db.query.mock.calls[1][0]).toContain('price_usd_e8');
  });

  it('does not manufacture accounting values for incomplete assets', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
        .mockResolvedValueOnce({ rows: [{
          asset_address: '0x2222222222222222222222222222222222222222', quantity_base_units: '1', decimals: 18,
          open_basis_usdc_micro: '0', accounting_status: 'INCOMPLETE', issue: 'missing receipt-derived acquisition basis',
          spot_price_usd_e8: '1', spot_value_usdc_micro: '1', weighted_average_cost_usdc_micro_per_base_unit: '0', unrealised_pnl_usdc_micro: '1', updated_at: '2026-09-17T12:00:00.000Z',
        }] }),
    };
    const service = new BasketsService(db as never, {} as never, {} as never);
    const result = await service.getAccountingSummary(basketAddress, '31337', basketAddress);
    expect(result.data.assets[0].weightedAverageCostUsdcMicroPerBaseUnit).toBeNull();
    expect(result.data.assets[0].unrealisedPnlUsdcMicro).toBeNull();
  });

  it('returns canonical as-of valuation observations without inventing missing points', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          observed_at: '2026-09-17T12:00:00.000Z',
          total_nav_usdc: '218.75',
          block_number: '42',
          basket_count: '2',
        }],
      }),
    };
    const service = new BasketsService(db as never, {} as never, {} as never);

    await expect(service.getValuationHistory('31337', basketAddress, '7D')).resolves.toEqual({
      data: {
        timeframe: '7D',
        points: [{
          observedAt: '2026-09-17T12:00:00.000Z',
          totalNavUsdc: 218.75,
          blockNumber: '42',
          basketCount: 2,
        }],
      },
    });
    expect(db.query).toHaveBeenCalledOnce();
    expect(db.query.mock.calls[0][0]).toContain("bno.valuation_status = 'COMPLETE'");
    expect(db.query.mock.calls[0][0]).toContain('JOIN LATERAL');
  });

  it('rejects unsupported valuation timeframes', async () => {
    const service = new BasketsService({ query: vi.fn() } as never, {} as never, {} as never);
    await expect(service.getValuationHistory('31337', basketAddress, 'forever')).rejects.toMatchObject({
      response: { error: 'INVALID_VALUATION_TIMEFRAME' },
    });
  });

  it('delegates quote and lending-event calls without changing their arguments', async () => {
    const quoteResponse = { success: true, data: { marker: 'quote' } };
    const eventResponse = { success: true };
    const quotePlanner = { quoteSwaps: vi.fn().mockResolvedValue(quoteResponse) };
    const lendingEvents = { recordLendingEvent: vi.fn().mockResolvedValue(eventResponse) };
    const service = new BasketsService(
      {} as never,
      quotePlanner as never,
      lendingEvents as never,
    );
    const quoteBody = { action: 'mint' as const, inputAmount: '42' };
    const eventBody = {
      chainId: 8453,
      basketAddress,
      action: 'REPAY' as const,
      assetAddress: '0x2222222222222222222222222222222222222222',
      amount: '42',
      winningProvider: 'AaveV3',
      winningPool: '0x3333333333333333333333333333333333333333',
      txHash: `0x${'4'.repeat(64)}`,
    };

    await expect(service.quoteSwaps(basketAddress, quoteBody)).resolves.toBe(quoteResponse);
    await expect(service.recordLendingEvent(eventBody)).resolves.toBe(eventResponse);
    expect(quotePlanner.quoteSwaps).toHaveBeenCalledWith(basketAddress, quoteBody);
    expect(lendingEvents.recordLendingEvent).toHaveBeenCalledWith(eventBody);
  });
});
