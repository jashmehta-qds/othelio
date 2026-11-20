import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminUpsideService } from './admin-upside.service';

describe('AdminUpsideService', () => {
  let service: AdminUpsideService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    service = new AdminUpsideService(mockDb);
  });

  describe('previewRound', () => {
    const underlying = '0xb200000000000000000000ab99cfa739e253872b'; // MSFTc

    it('rejects round preview if expiry is in the past', async () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 3600;

      await expect(
        service.previewRound({
          underlying,
          expiryTimestamp: pastExpiry,
        }),
      ).rejects.toThrow('Expiry timestamp must be strictly in the future');
    });

    it('calculates 4 standard preset strikes from reference price and expected move', async () => {
      // Future Friday
      const futureFriday = Math.floor(Date.now() / 1000) + 86400 * 7;

      // Mock DB price of $500.00
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            price_usd_e8: '50000000000',
            observed_at: new Date().toISOString(),
          },
        ],
      });

      const preview = await service.previewRound({
        underlying,
        expiryTimestamp: futureFriday,
        expectedMove: '2000000000', // $20.00 expected move
      });

      expect(preview.underlying.symbol).toBe('MSFTc');
      expect(preview.referencePriceFormatted).toBe('500.00');
      expect(preview.expectedMoveFormatted).toBe('20.00');

      // 4 target labels: Starting price, Reach, Strong move, Long shot
      expect(preview.strikes.length).toBe(4);
      expect(preview.strikes[0].targetLabel).toBe('Starting price');
      expect(preview.strikes[0].strikePriceFormatted).toBe('500.00'); // K0 = P0

      expect(preview.strikes[1].targetLabel).toBe('Reach');
      expect(preview.strikes[1].strikePriceFormatted).toBe('510.00'); // K1 = P0 + 0.5 * 20 = 510

      expect(preview.strikes[2].targetLabel).toBe('Strong move');
      expect(preview.strikes[2].strikePriceFormatted).toBe('520.00'); // K2 = P0 + 1.0 * 20 = 520

      expect(preview.strikes[3].targetLabel).toBe('Long shot');
      expect(preview.strikes[3].strikePriceFormatted).toBe('540.00'); // K3 = P0 + 2.0 * 20 = 540

      expect(preview.transactions.length).toBe(1);
      expect(preview.transactions[0].method).toBe('registerRound');
      expect(preview.transactions[0].target.startsWith('0x')).toBe(true);
      const config = preview.transactions[0].args[0] as Record<string, unknown>;
      expect(Object.keys(config)).toHaveLength(13);
      expect(config.maxStrike).toBeDefined();
    });

    it('flags calendar warning if expiry falls on weekend', async () => {
      // Find a Saturday timestamp
      const d = new Date();
      d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
      d.setHours(16, 0, 0, 0);
      const saturdayTs = Math.floor(d.getTime() / 1000);

      const preview = await service.previewRound({
        underlying,
        expiryTimestamp: saturdayTs,
      });

      expect(preview.calendarCheck.valid).toBe(false);
      expect(preview.calendarCheck.note).toContain('weekend');
    });
  });
});
