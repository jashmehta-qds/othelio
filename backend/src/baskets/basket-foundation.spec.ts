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
