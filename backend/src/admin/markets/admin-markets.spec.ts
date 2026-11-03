import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AdminMarketsService } from './admin-markets.service';
import { validateExpiryCalendar } from './calendar.util';

describe('AdminMarketsService & Calendar Utilities', () => {
  const msftAddress = '0xB200000000000000000000Ab99cFa739E253872B';

  it('rejects an expiry on a weekend (Saturday or Sunday)', () => {
    // 2026-11-07 is Saturday. 16:00 ET is 21:00 UTC (after standard time transition on Nov 1).
    const saturdayExpiry = Math.floor(new Date('2026-11-07T21:00:00Z').getTime() / 1000);
    const result = validateExpiryCalendar(saturdayExpiry);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('weekend');
  });

  it('rejects an expiry on a US equity holiday (e.g. Thanksgiving 2026-11-26)', () => {
    // Thanksgiving is 4th Thursday in November: 2026-11-26. 16:00 ET is 21:00 UTC.
    const thanksgivingExpiry = Math.floor(new Date('2026-11-26T21:00:00Z').getTime() / 1000);
    const result = validateExpiryCalendar(thanksgivingExpiry);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Thanksgiving Day');
  });

  it('rejects an expiry outside market close window (e.g. 10:00 AM ET)', () => {
    // 2026-11-06 is Friday. 10:00 AM ET is 15:00 UTC.
    const morningExpiry = Math.floor(new Date('2026-11-06T15:00:00Z').getTime() / 1000);
    const result = validateExpiryCalendar(morningExpiry);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('16:00 ET');
  });

  it('accepts an expiry on a valid Friday at 16:00 ET (4:00 PM)', () => {
    // 2026-11-06 is Friday. 16:00 ET is 21:00 UTC (EST, UTC-5).
    const validFridayExpiry = Math.floor(new Date('2026-11-06T21:00:00Z').getTime() / 1000);
    const result = validateExpiryCalendar(validFridayExpiry);
    expect(result.valid).toBe(true);
    expect(result.sessionCloseDeltaMinutes).toBe(0);
    expect(result.localTimeStr).toContain('2026-11-06 16:00 ET');
  });

  it('previews market creation with percentage floor/cap, payoff scenarios, and approval transactions', async () => {
    const validFridayExpiry = Math.floor(new Date('2026-11-06T21:00:00Z').getTime() / 1000);
    const service = new AdminMarketsService();

    const preview = await service.previewMarket({
      underlying: msftAddress,
      floorPercent: 80,
      capPercent: 120,
      expiryTimestamp: validFridayExpiry,
      chainId: 8453,
    });

    expect(preview.underlying.symbol).toBe('MSFTc');
    expect(preview.floorPrice).toBeDefined();
    expect(preview.capPrice).toBeDefined();
    expect(BigInt(preview.floorPrice) < BigInt(preview.capPrice)).toBe(true);
    expect(preview.payoffScenarios.length).toBe(5);

    // Should include setApprovedExpiry and createSeries transactions
    expect(preview.transactions.length).toBe(2);
    expect(preview.transactions[0].method).toBe('setApprovedExpiry');
    expect(preview.transactions[1].method).toBe('createSeries');
  });

  it('rejects duplicate terms when matching series exists in database', async () => {
    const validFridayExpiry = Math.floor(new Date('2026-11-06T21:00:00Z').getTime() / 1000);

    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [{ exists: 1 }],
      }),
    };

    const service = new AdminMarketsService(mockDb as any);

    await expect(
      service.previewMarket({
        underlying: msftAddress,
        floorPercent: 80,
        capPercent: 120,
        expiryTimestamp: validFridayExpiry,
        chainId: 8453,
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
