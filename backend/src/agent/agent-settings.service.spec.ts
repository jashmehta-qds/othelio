import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AgentSettingsService, DEFAULT_AGENT_SETTINGS } from './agent-settings.service';

describe('AgentSettingsService', () => {
  let service: AgentSettingsService;
  let mockDb: { query: ReturnType<typeof vi.fn> };

  const testAddress = '0x1111111111111111111111111111111111111111';

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    service = new AgentSettingsService(mockDb as never);
  });

  describe('getAgentSettings', () => {
    it('returns default settings when no row exists', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const settings = await service.getAgentSettings(testAddress);
      expect(settings.accountAddress).toBe(testAddress.toLowerCase());
      expect(settings.maxSpendPerTxUsd).toBe(DEFAULT_AGENT_SETTINGS.maxSpendPerTxUsd);
      expect(settings.dailySpendLimitUsd).toBe(DEFAULT_AGENT_SETTINGS.dailySpendLimitUsd);
      expect(settings.hasApiKey).toBe(false);
    });

    it('returns stored settings and parses numbers correctly', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            account_address: testAddress,
            api_key_hash: 'abc123hash',
            autonomy_tier: 'staged',
            max_spend_per_tx_usd: '300.00',
            daily_spend_limit_usd: '1500.00',
            spent_today_usd: '50.00',
            spent_today_reset_at: new Date().toISOString(),
            max_slippage_bps: 40,
            allowed_assets: ['USDC', 'AAPLc'],
            restrict_to_market_hours: true,
            min_rebalance_drift_bps: 250,
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const settings = await service.getAgentSettings(testAddress);
      expect(settings.maxSpendPerTxUsd).toBe(300);
      expect(settings.dailySpendLimitUsd).toBe(1500);
      expect(settings.spentTodayUsd).toBe(50);
      expect(settings.hasApiKey).toBe(true);
      expect(settings.allowedAssets).toEqual(['USDC', 'AAPLc']);
    });
  });

  describe('upsertAgentSettings validation', () => {
    it('rejects daily spend limit less than per-tx limit', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] }); // For getAgentSettings current check

      await expect(
        service.upsertAgentSettings(testAddress, {
          maxSpendPerTxUsd: 1000,
          dailySpendLimitUsd: 500,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects invalid slippage (> 500 bps)', async () => {
      await expect(
        service.upsertAgentSettings(testAddress, {
          maxSlippageBps: 600,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('API key generation and verification', () => {
    it('generates a unique API key with prefix oth_agent_', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const res = await service.generateApiKey(testAddress);
      expect(res.apiKey.startsWith('oth_agent_')).toBe(true);
      expect(res.maskedKey).toContain('••••••••');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO agent_settings'),
        expect.arrayContaining([testAddress.toLowerCase()]),
      );
    });

    it('rejects invalid API key with UnauthorizedException', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.verifyAgentApiKey('invalid_key')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('assertGuardrails', () => {
    const baseSettings = {
      accountAddress: testAddress.toLowerCase(),
      ...DEFAULT_AGENT_SETTINGS,
      spentTodayUsd: 100,
      spentTodayResetAt: new Date().toISOString(),
      hasApiKey: true,
      updatedAt: new Date().toISOString(),
    };

    it('throws if requested spend exceeds maxSpendPerTxUsd', () => {
      expect(() => {
        service.assertGuardrails(baseSettings, 600, ['USDC']);
      }).toThrow(ForbiddenException);
    });

    it('throws if requested spend exceeds remaining daily budget', () => {
      const nearLimitSettings = {
        ...baseSettings,
        dailySpendLimitUsd: 1000,
        spentTodayUsd: 900,
      };

      expect(() => {
        service.assertGuardrails(nearLimitSettings, 200, ['USDC']);
      }).toThrow(ForbiddenException);
    });

    it('throws if asset is not in allowedAssets whitelist', () => {
      expect(() => {
        service.assertGuardrails(baseSettings, 100, ['USDC', 'SHIBA_INU_MEME']);
      }).toThrow(ForbiddenException);
    });

    it('allows valid spend within all limits', () => {
      // Mock market open for equity check
      vi.spyOn(service, 'isUsMarketOpen').mockReturnValue(true);

      expect(() => {
        service.assertGuardrails(baseSettings, 200, ['USDC', 'AAPLc']);
      }).not.toThrow();
    });
  });
});
