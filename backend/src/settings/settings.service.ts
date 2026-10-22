import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { addressSchema } from '@othelio/shared';
import { DatabaseService } from '../database/database.service';

export interface AccountSettingsDto {
  slippageTolerance: number;
  deadlineMinutes: number;
  mevProtection: boolean;
  riskTier: string;
  customRiskBuffer: number | null;
  stalePriceTrades: 'allow' | 'warn' | 'reject';
}

export interface AccountSettingsResponse extends AccountSettingsDto {
  accountAddress: string;
  updatedAt: string;
}

const DEFAULT_SETTINGS: AccountSettingsDto = {
  slippageTolerance: 0.5,
  deadlineMinutes: 20,
  mevProtection: true,
  riskTier: 'safe',
  customRiskBuffer: null,
  stalePriceTrades: 'warn',
};

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DatabaseService)
    private readonly db: DatabaseService,
  ) {}

  async getAccountSettings(rawAddress: string): Promise<AccountSettingsResponse> {
    const address = addressSchema.parse(rawAddress).toLowerCase();

    const result = await this.db.query(
      `SELECT account_address, slippage_tolerance, deadline_minutes, mev_protection, risk_tier, custom_risk_buffer, stale_price_trades, updated_at
       FROM account_settings
       WHERE LOWER(account_address) = $1`,
      [address],
    );

    if (result.rows.length === 0) {
      return {
        accountAddress: address,
        slippageTolerance: DEFAULT_SETTINGS.slippageTolerance,
        deadlineMinutes: DEFAULT_SETTINGS.deadlineMinutes,
        mevProtection: DEFAULT_SETTINGS.mevProtection,
        riskTier: DEFAULT_SETTINGS.riskTier,
        customRiskBuffer: DEFAULT_SETTINGS.customRiskBuffer,
        stalePriceTrades: DEFAULT_SETTINGS.stalePriceTrades,
        updatedAt: new Date().toISOString(),
      };
    }

    const row = result.rows[0];
    return {
      accountAddress: row.account_address.trim().toLowerCase(),
      slippageTolerance: parseFloat(row.slippage_tolerance),
      deadlineMinutes: parseInt(row.deadline_minutes, 10),
      mevProtection: Boolean(row.mev_protection),
      riskTier: row.risk_tier,
      customRiskBuffer: row.custom_risk_buffer !== null ? parseFloat(row.custom_risk_buffer) : null,
      stalePriceTrades: row.stale_price_trades ?? DEFAULT_SETTINGS.stalePriceTrades,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async upsertAccountSettings(
    rawAddress: string,
    body: Partial<AccountSettingsDto>,
  ): Promise<AccountSettingsResponse> {
    const address = addressSchema.parse(rawAddress).toLowerCase();
    const existing = await this.getAccountSettings(address);
    const merged = { ...existing, ...body };

    const slippageTolerance =
      body.slippageTolerance !== undefined ? Number(body.slippageTolerance) : existing.slippageTolerance;
    if (isNaN(slippageTolerance) || slippageTolerance < 0.01 || slippageTolerance > 50) {
      throw new BadRequestException('slippageTolerance must be between 0.01% and 50%');
    }

    const deadlineMinutes =
      body.deadlineMinutes !== undefined ? parseInt(String(body.deadlineMinutes), 10) : existing.deadlineMinutes;
    if (isNaN(deadlineMinutes) || deadlineMinutes < 1 || deadlineMinutes > 1440) {
      throw new BadRequestException('deadlineMinutes must be between 1 and 1440');
    }

    const mevProtection =
      body.mevProtection !== undefined ? Boolean(body.mevProtection) : existing.mevProtection;

    const riskTier = body.riskTier ? String(body.riskTier).toLowerCase() : existing.riskTier;
    if (!['safe', 'normal', 'risky', 'custom'].includes(riskTier)) {
      throw new BadRequestException('riskTier must be one of: safe, normal, risky, custom');
    }

    const stalePriceTrades = merged.stalePriceTrades;
    if (!['allow', 'warn', 'reject'].includes(stalePriceTrades)) {
      throw new BadRequestException('stalePriceTrades must be one of: allow, warn, reject');
    }

    let customRiskBuffer: number | null = existing.customRiskBuffer;
    if (body.customRiskBuffer !== undefined) {
      customRiskBuffer = null;
    }
    if (body.customRiskBuffer !== undefined && body.customRiskBuffer !== null) {
      const buf = parseFloat(String(body.customRiskBuffer));
      if (!isNaN(buf)) {
        if (buf < 5 || buf > 50) {
          throw new BadRequestException('customRiskBuffer must be between 5% and 50%');
        }
        customRiskBuffer = buf;
      }
    }

    const result = await this.db.query(
      `INSERT INTO account_settings
       (account_address, slippage_tolerance, deadline_minutes, mev_protection, risk_tier, custom_risk_buffer, stale_price_trades, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (account_address) DO UPDATE SET
         slippage_tolerance = EXCLUDED.slippage_tolerance,
         deadline_minutes = EXCLUDED.deadline_minutes,
         mev_protection = EXCLUDED.mev_protection,
         risk_tier = EXCLUDED.risk_tier,
         custom_risk_buffer = EXCLUDED.custom_risk_buffer,
         stale_price_trades = EXCLUDED.stale_price_trades,
         updated_at = NOW()
       RETURNING account_address, slippage_tolerance, deadline_minutes, mev_protection, risk_tier, custom_risk_buffer, stale_price_trades, updated_at`,
      [address, slippageTolerance, deadlineMinutes, mevProtection, riskTier, customRiskBuffer, stalePriceTrades],
    );

    const row = result.rows[0];
    return {
      accountAddress: row.account_address.trim().toLowerCase(),
      slippageTolerance: parseFloat(row.slippage_tolerance),
      deadlineMinutes: parseInt(row.deadline_minutes, 10),
      mevProtection: Boolean(row.mev_protection),
      riskTier: row.risk_tier,
      customRiskBuffer: row.custom_risk_buffer !== null ? parseFloat(row.custom_risk_buffer) : null,
      stalePriceTrades: row.stale_price_trades,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
