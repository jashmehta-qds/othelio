import { describe, expect, it, vi } from 'vitest';
import { NavCompactionService } from './nav-compaction.service';

describe('NavCompactionService', () => {
  it('executes tiered downsampling queries for Tier 2, Tier 3, and Tier 4', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 15 }) // Tier 2
        .mockResolvedValueOnce({ rowCount: 8 })  // Tier 3
        .mockResolvedValueOnce({ rowCount: 2 }), // Tier 4
    };

    const service = new NavCompactionService(db as never);
    const result = await service.compactNavObservations();

    expect(db.query).toHaveBeenCalledTimes(3);

    // Verify all queries target 'HOURLY' and exclude 'EVENT'
    const tier2Sql = db.query.mock.calls[0][0];
    const tier3Sql = db.query.mock.calls[1][0];
    const tier4Sql = db.query.mock.calls[2][0];

    expect(tier2Sql).toContain("kind = 'HOURLY'");
    expect(tier2Sql).toContain("date_bin('10 minutes'::interval");
    expect(tier2Sql).toContain("NOW() - INTERVAL '1 day'");

    expect(tier3Sql).toContain("kind = 'HOURLY'");
    expect(tier3Sql).toContain("date_bin('1 hour'::interval");
    expect(tier3Sql).toContain("NOW() - INTERVAL '7 days'");

    expect(tier4Sql).toContain("kind = 'HOURLY'");
    expect(tier4Sql).toContain("date_bin('1 day'::interval");
    expect(tier4Sql).toContain("NOW() - INTERVAL '30 days'");

    expect(result).toEqual({
      tier2Deleted: 15,
      tier3Deleted: 8,
      tier4Deleted: 2,
      totalDeleted: 25,
    });
  });
});
