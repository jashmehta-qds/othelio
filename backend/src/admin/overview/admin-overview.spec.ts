import { describe, expect, it, vi } from 'vitest';
import { AdminOverviewService } from './admin-overview.service';

describe('AdminOverviewService', () => {
  it('returns default overview state with asOfBlock and metric definitions', async () => {
    const mockDb = {
      query: vi.fn().mockImplementation((query: string) => {
        if (query.includes('all_activity')) {
          return Promise.resolve({
            rows: [{ count_24h: 5, count_7d: 12, count_30d: 40, count_all: 50 }],
          });
        }
        if (query.includes('FROM baskets')) {
          return Promise.resolve({
            rows: [{ count: 3 }],
          });
        }
        if (query.includes('FROM risk_split_series')) {
          return Promise.resolve({
            rows: [{ total_count: 4, open_count: 2, expired_count: 1, settled_count: 1, failed_settlement_count: 0 }],
          });
        }
        if (query.includes('FROM risk_split_events')) {
          return Promise.resolve({
            rows: [{ mint_volume: '1000000000', redeem_volume: '400000000' }],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const mockRiskSplitService = {
      getIndexerFreshness: vi.fn().mockResolvedValue({
        isFresh: true,
        observedHeadBlock: 200,
        lastIndexedBlock: 198,
        blockLag: 2,
        observedHeadAt: new Date().toISOString(),
      }),
    };

    const service = new AdminOverviewService(mockDb as any, mockRiskSplitService as any);
    const result = await service.getOverview(8453);

    expect(result.asOfBlock).toBe(198);
    expect(result.indexerHealth.isFresh).toBe(true);
    expect(result.indexerHealth.blockLag).toBe(2);
    expect(result.activeWallets.last24h).toBe(5);
    expect(result.activeWallets.last7d).toBe(12);
    expect(result.activeWallets.allTime).toBe(50);
    expect(result.basketsCount).toBe(3);
    expect(result.supportedAssetsCount).toBeGreaterThanOrEqual(13);
    expect(result.riskSplit.totalSeries).toBe(4);
    expect(result.riskSplit.openSeries).toBe(2);
    expect(result.riskSplit.expiredSeries).toBe(1);
    expect(result.riskSplit.settledSeries).toBe(1);
    expect(result.riskSplit.totalMintVolumeUnderlying).toBe('1000000000');
    expect(result.riskSplit.totalRedemptionVolumeUnderlying).toBe('400000000');
    expect(result.riskSplit.activeCollateralUnderlying).toBe('600000000');
  });
});
