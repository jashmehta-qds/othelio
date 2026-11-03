import { describe, expect, it, vi } from 'vitest';
import { AdminOperationsService } from './admin-operations.service';

describe('AdminOperationsService', () => {
  it('constructs operations response with expiry queue, audit trail, and incidents', async () => {
    const nowSecs = Math.floor(Date.now() / 1000);
    const pastExpiry = nowSecs - 3600; // 1 hour ago
    const futureExpiry = nowSecs + 86400; // tomorrow

    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            series_address: '0x1111111111111111111111111111111111111111',
            underlying_address: '0xb200000000000000000000ab99cfa739e253872b',
            expiry_timestamp: pastExpiry,
            is_settled: false,
            operations_audit_status: 'NORMAL',
          },
          {
            series_address: '0x2222222222222222222222222222222222222222',
            underlying_address: '0xb200000000000000000000ab99cfa739e253872b',
            expiry_timestamp: futureExpiry,
            is_settled: false,
            operations_audit_status: 'NORMAL',
          },
          {
            series_address: '0x3333333333333333333333333333333333333333',
            underlying_address: '0xb200000000000000000000ab99cfa739e253872b',
            expiry_timestamp: pastExpiry - 10000,
            is_settled: true,
            settled_price: '51200000000',
            settled_round_id: '18446744073709555100',
            settled_feed_updated_at: new Date().toISOString(),
            operations_audit_status: 'NORMAL',
          },
        ],
      }),
    };

    const mockRiskSplitService = {
      getIndexerFreshness: vi.fn().mockResolvedValue({
        lastIndexedBlock: 500,
        isFresh: true,
        blockLag: 0,
      }),
    };

    const service = new AdminOperationsService(mockDb as any, mockRiskSplitService as any);
    const result = await service.getOperations(8453);

    expect(result.asOfBlock).toBe(500);
    expect(result.expiryQueue.length).toBe(2);
    expect(result.settlementAuditTrail.length).toBe(1);

    const expiredItem = result.expiryQueue.find((q) => q.isExpired);
    expect(expiredItem).toBeDefined();
    expect(expiredItem?.seriesAddress).toBe('0x1111111111111111111111111111111111111111');

    const settledItem = result.settlementAuditTrail[0];
    expect(settledItem.settledPrice).toBe('$512.00');
    expect(settledItem.settledRoundId).toBe('18446744073709555100');
  });

  it('generates an incident alert if indexer is lagging', async () => {
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const mockRiskSplitService = {
      getIndexerFreshness: vi.fn().mockResolvedValue({
        lastIndexedBlock: 400,
        isFresh: false,
        blockLag: 120,
      }),
    };

    const service = new AdminOperationsService(mockDb as any, mockRiskSplitService as any);
    const result = await service.getOperations(8453);

    expect(result.incidentAlerts.length).toBeGreaterThan(0);
    expect(result.incidentAlerts[0].message).toContain('Indexer lag detected: 120 blocks');
  });
});
