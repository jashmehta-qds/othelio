import { BadRequestException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { addressSchema } from '@othelio/shared';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/database.service';
import { AgentSettingsDto, AgentSettingsResponse } from './agent.types';

export const DEFAULT_AGENT_SETTINGS: AgentSettingsDto = {
  autonomyTier: 'staged',
  maxSpendPerTxUsd: 500.0,
  dailySpendLimitUsd: 2000.0,
  maxSlippageBps: 50, // 0.50%
  allowedAssets: ['USDC', 'AAPLc', 'MSFTc', 'NVDAc', 'GOOGLc', 'AMZNc', 'METAc', 'TSLAc', 'MSTRc', 'SPCXc', 'SNDKc'],
  restrictToMarketHours: true,
  minRebalanceDriftBps: 300, // 3%
};

@Injectable()
export class AgentSettingsService {
  constructor(
    @Inject(DatabaseService)
    private readonly db: DatabaseService,
  ) {}

  hashApiKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey.trim()).digest('hex');
  }

  maskApiKey(rawKeyOrHash: string): string {
    if (rawKeyOrHash.length <= 8) return '••••••••';
    return `${rawKeyOrHash.slice(0, 6)}••••••••${rawKeyOrHash.slice(-4)}`;
  }

  async getAgentSettings(rawAddress: string): Promise<AgentSettingsResponse> {
    const address = addressSchema.parse(rawAddress).toLowerCase();

    const result = await this.db.query(
      `SELECT account_address, api_key_hash, autonomy_tier, max_spend_per_tx_usd, 
              daily_spend_limit_usd, spent_today_usd, spent_today_reset_at, max_slippage_bps,
              allowed_assets, restrict_to_market_hours, min_rebalance_drift_bps, updated_at
       FROM agent_settings
       WHERE LOWER(account_address) = $1`,
      [address],
    );

    if (result.rows.length === 0) {
      return {
        accountAddress: address,
        ...DEFAULT_AGENT_SETTINGS,
        spentTodayUsd: 0,
        spentTodayResetAt: new Date().toISOString(),
        hasApiKey: false,
        updatedAt: new Date().toISOString(),
      };
    }

    const row = result.rows[0];
    const resetAt = new Date(row.spent_today_reset_at);
    const now = new Date();
    const isPast24Hours = now.getTime() - resetAt.getTime() > 24 * 60 * 60 * 1000;

    let spentToday = Number(row.spent_today_usd);
    let currentResetAt = row.spent_today_reset_at;

    if (isPast24Hours) {
      spentToday = 0;
      currentResetAt = now.toISOString();
      await this.db.query(
        `UPDATE agent_settings 
         SET spent_today_usd = 0, spent_today_reset_at = $1 
         WHERE account_address = $2`,
        [currentResetAt, address],
      );
    }

    return {
      accountAddress: address,
      autonomyTier: row.autonomy_tier,
      maxSpendPerTxUsd: Number(row.max_spend_per_tx_usd),
      dailySpendLimitUsd: Number(row.daily_spend_limit_usd),
      spentTodayUsd: spentToday,
      spentTodayResetAt: new Date(currentResetAt).toISOString(),
      maxSlippageBps: row.max_slippage_bps,
      allowedAssets: row.allowed_assets || DEFAULT_AGENT_SETTINGS.allowedAssets,
      restrictToMarketHours: row.restrict_to_market_hours,
      minRebalanceDriftBps: row.min_rebalance_drift_bps,
      hasApiKey: Boolean(row.api_key_hash),
      maskedApiKey: row.api_key_hash ? this.maskApiKey(row.api_key_hash) : undefined,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async upsertAgentSettings(rawAddress: string, patch: Partial<AgentSettingsDto>): Promise<AgentSettingsResponse> {
    const address = addressSchema.parse(rawAddress).toLowerCase();

    if (patch.maxSpendPerTxUsd !== undefined && patch.maxSpendPerTxUsd <= 0) {
      throw new BadRequestException('Max spend per transaction must be greater than zero.');
    }
    if (patch.dailySpendLimitUsd !== undefined && patch.dailySpendLimitUsd <= 0) {
      throw new BadRequestException('Daily spend limit must be greater than zero.');
    }
    if (patch.maxSlippageBps !== undefined && (patch.maxSlippageBps < 1 || patch.maxSlippageBps > 500)) {
      throw new BadRequestException('Max slippage must be between 1 and 500 bps (0.01% - 5%).');
    }
    if (patch.minRebalanceDriftBps !== undefined && (patch.minRebalanceDriftBps < 50 || patch.minRebalanceDriftBps > 5000)) {
      throw new BadRequestException('Min rebalance drift must be between 50 and 5000 bps (0.5% - 50%).');
    }

    const current = await this.getAgentSettings(address);
    const updated: AgentSettingsDto = {
      autonomyTier: patch.autonomyTier ?? current.autonomyTier,
      maxSpendPerTxUsd: patch.maxSpendPerTxUsd ?? current.maxSpendPerTxUsd,
      dailySpendLimitUsd: patch.dailySpendLimitUsd ?? current.dailySpendLimitUsd,
      maxSlippageBps: patch.maxSlippageBps ?? current.maxSlippageBps,
      allowedAssets: patch.allowedAssets ?? current.allowedAssets,
      restrictToMarketHours: patch.restrictToMarketHours ?? current.restrictToMarketHours,
      minRebalanceDriftBps: patch.minRebalanceDriftBps ?? current.minRebalanceDriftBps,
    };

    if (updated.dailySpendLimitUsd < updated.maxSpendPerTxUsd) {
      throw new BadRequestException('Daily spend limit cannot be less than maximum spend per transaction.');
    }

    await this.db.query(
      `INSERT INTO agent_settings (
        account_address, api_key_hash, autonomy_tier, max_spend_per_tx_usd,
        daily_spend_limit_usd, max_slippage_bps, allowed_assets,
        restrict_to_market_hours, min_rebalance_drift_bps, updated_at
      )
      VALUES ($1, COALESCE((SELECT api_key_hash FROM agent_settings WHERE account_address = $1), ''), $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (account_address) DO UPDATE SET
        autonomy_tier = EXCLUDED.autonomy_tier,
        max_spend_per_tx_usd = EXCLUDED.max_spend_per_tx_usd,
        daily_spend_limit_usd = EXCLUDED.daily_spend_limit_usd,
        max_slippage_bps = EXCLUDED.max_slippage_bps,
        allowed_assets = EXCLUDED.allowed_assets,
        restrict_to_market_hours = EXCLUDED.restrict_to_market_hours,
        min_rebalance_drift_bps = EXCLUDED.min_rebalance_drift_bps,
        updated_at = NOW()`,
      [
        address,
        updated.autonomyTier,
        updated.maxSpendPerTxUsd,
        updated.dailySpendLimitUsd,
        updated.maxSlippageBps,
        updated.allowedAssets,
        updated.restrictToMarketHours,
        updated.minRebalanceDriftBps,
      ],
    );

    return this.getAgentSettings(address);
  }

  async generateApiKey(rawAddress: string): Promise<{ apiKey: string; maskedKey: string }> {
    const address = addressSchema.parse(rawAddress).toLowerCase();
    const rawApiKey = `oth_agent_${crypto.randomBytes(24).toString('hex')}`;
    const hash = this.hashApiKey(rawApiKey);

    await this.db.query(
      `INSERT INTO agent_settings (account_address, api_key_hash, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (account_address) DO UPDATE SET
         api_key_hash = EXCLUDED.api_key_hash,
         updated_at = NOW()`,
      [address, hash],
    );

    return {
      apiKey: rawApiKey,
      maskedKey: this.maskApiKey(rawApiKey),
    };
  }

  async revokeApiKey(rawAddress: string): Promise<AgentSettingsResponse> {
    const address = addressSchema.parse(rawAddress).toLowerCase();
    await this.db.query(
      `UPDATE agent_settings SET api_key_hash = '', updated_at = NOW() WHERE account_address = $1`,
      [address],
    );
    return this.getAgentSettings(address);
  }

  async verifyAgentApiKey(rawApiKey: string): Promise<AgentSettingsResponse> {
    if (!rawApiKey || typeof rawApiKey !== 'string') {
      throw new UnauthorizedException('Valid agent API key required');
    }

    const hash = this.hashApiKey(rawApiKey);
    const result = await this.db.query(
      `SELECT account_address FROM agent_settings WHERE api_key_hash = $1`,
      [hash],
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedException('Invalid or revoked agent API key');
    }

    const accountAddress = result.rows[0].account_address;
    return this.getAgentSettings(accountAddress);
  }

  isUsMarketOpen(): boolean {
    const now = new Date();
    // Convert to US Eastern Time
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
    });
    const parts = formatter.formatToParts(now);
    const weekday = parts.find((p) => p.type === 'weekday')?.value;
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);

    // Monday through Friday only
    if (weekday === 'Sat' || weekday === 'Sun') return false;

    // 9:30 AM to 4:00 PM Eastern Time
    const totalMinutes = hour * 60 + minute;
    return totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60;
  }

  assertGuardrails(settings: AgentSettingsResponse, amountUsd: number, assetSymbols: string[]) {
    if (settings.autonomyTier === 'advisory') {
      throw new ForbiddenException({
        error: 'AUTONOMY_TIER_ADVISORY',
        message: 'Agent is in advisory mode and cannot stage executable transactions.',
      });
    }

    if (amountUsd > settings.maxSpendPerTxUsd) {
      throw new ForbiddenException({
        error: 'PER_TX_LIMIT_EXCEEDED',
        message: `Requested spend of $${amountUsd.toFixed(2)} exceeds agent limit of $${settings.maxSpendPerTxUsd.toFixed(2)}.`,
      });
    }

    if (settings.spentTodayUsd + amountUsd > settings.dailySpendLimitUsd) {
      const remaining = Math.max(0, settings.dailySpendLimitUsd - settings.spentTodayUsd);
      throw new ForbiddenException({
        error: 'DAILY_BUDGET_EXCEEDED',
        message: `Requested spend of $${amountUsd.toFixed(2)} exceeds remaining daily agent budget of $${remaining.toFixed(2)}.`,
      });
    }

    // Check asset whitelist
    const allowedSet = new Set(settings.allowedAssets.map((a) => a.toUpperCase()));
    for (const sym of assetSymbols) {
      const clean = sym.toUpperCase();
      if (!allowedSet.has(clean)) {
        throw new ForbiddenException({
          error: 'ASSET_NOT_ALLOWED',
          message: `Asset ${sym} is not permitted by the user's agent guardrails.`,
        });
      }
    }

    // Check market hours if any asset is an equity token
    const hasEquityToken = assetSymbols.some((s) => s.toUpperCase() !== 'USDC');
    if (settings.restrictToMarketHours && hasEquityToken && !this.isUsMarketOpen()) {
      throw new ForbiddenException({
        error: 'MARKET_HOURS_RESTRICTED',
        message: 'Agent trading on tokenized equity assets is restricted to US stock market hours (9:30 AM - 4:00 PM ET, Mon-Fri).',
      });
    }
  }

  async recordSpend(rawAddress: string, amountUsd: number) {
    const address = addressSchema.parse(rawAddress).toLowerCase();
    await this.db.query(
      `UPDATE agent_settings 
       SET spent_today_usd = spent_today_usd + $1, updated_at = NOW() 
       WHERE LOWER(account_address) = $2`,
      [amountUsd, address],
    );
  }
}
