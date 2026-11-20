import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AdminUpsideService } from './admin-upside.service';

describe('AdminUpsideService', () => {
  let service: AdminUpsideService;
  let mockDb: any;

  beforeEach(() => {
    vi.stubEnv('UPSIDE_FACTORY_ADDRESS', '0x5991A2dF15A8F6A256D3Ec51E99254Cd3fb576A9');
    vi.stubEnv('UPSIDE_SETTLEMENT_ADAPTER_ADDRESS', '0xF62849F9A0B5Bf2913b396098F7c7019b51A820a');
    mockDb = {
      query: vi.fn(),
    };
    service = new AdminUpsideService(mockDb);
    vi.spyOn(service as any, 'createClient').mockReturnValue({
      getCode: vi.fn().mockResolvedValue('0x6000'),
      readContract: vi.fn().mockResolvedValue([100n, 500_00000000n, 0n, BigInt(Math.floor(Date.now() / 1000)), 100n]),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('previewRound', () => {
    const underlying = '0xb200000000000000000000ab99cfa739e253872b'; // MSFTc

    it('rejects a missing Upside deployment before returning transaction instructions', async () => {
      vi.stubEnv('UPSIDE_FACTORY_ADDRESS', '');
      await expect(service.previewRound({
        underlying,
        expiryTimestamp: Math.floor(Date.now() / 1000) + 86400,
      })).rejects.toThrow('UPSIDE_FACTORY_ADDRESS');
    });

    it('rejects an Upside factory address with no contract code', async () => {
      vi.mocked((service as any).createClient().getCode).mockResolvedValueOnce(undefined);
      await expect(service.previewRound({
        underlying,
        expiryTimestamp: Math.floor(Date.now() / 1000) + 86400,
      })).rejects.toThrow('no contract code');
    });

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
      expect(() => JSON.stringify(preview)).not.toThrow();
      expect(preview.transactions[0].args[0].referencePrice).toBe('50000000000');
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

  describe('togglePublicCreationTx', () => {
    it('generates valid transaction to toggle public strike creation', () => {
      const tx = service.togglePublicCreationTx(8453, 1, true);
      expect(tx.method).toBe('setPublicCreationEnabled');
      expect(tx.args).toEqual([1, true]);
      expect(tx.target.startsWith('0x')).toBe(true);
    });
  });
});
