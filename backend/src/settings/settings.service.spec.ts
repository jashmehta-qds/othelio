import { describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings.service';
import { BadRequestException } from '@nestjs/common';

describe('SettingsService', () => {
  const mockDb = {
    query: vi.fn(),
  };

  const service = new SettingsService(mockDb as never);
  const sampleAddress = '0x1111111111111111111111111111111111111111';

  it('returns default settings when account does not exist in DB', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] });

    const result = await service.getAccountSettings(sampleAddress);

    expect(result.accountAddress).toBe(sampleAddress.toLowerCase());
    expect(result.slippageTolerance).toBe(0.5);
    expect(result.deadlineMinutes).toBe(20);
    expect(result.mevProtection).toBe(true);
    expect(result.riskTier).toBe('safe');
    expect(result.customRiskBuffer).toBeNull();
  });

  it('returns stored settings when account exists in DB', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [
        {
          account_address: sampleAddress,
          slippage_tolerance: '1.20',
          deadline_minutes: 30,
          mev_protection: false,
          risk_tier: 'custom',
          custom_risk_buffer: '15.00',
          updated_at: '2026-09-11T12:00:00.000Z',
        },
      ],
    });

    const result = await service.getAccountSettings(sampleAddress);

    expect(result.slippageTolerance).toBe(1.2);
    expect(result.deadlineMinutes).toBe(30);
    expect(result.mevProtection).toBe(false);
    expect(result.riskTier).toBe('custom');
    expect(result.customRiskBuffer).toBe(15);
  });

  it('upserts valid settings successfully', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [
        {
          account_address: sampleAddress,
          slippage_tolerance: '0.80',
          deadline_minutes: 10,
          mev_protection: true,
          risk_tier: 'normal',
          custom_risk_buffer: null,
          updated_at: '2026-09-11T12:05:00.000Z',
        },
      ],
    });

    const result = await service.upsertAccountSettings(sampleAddress, {
      slippageTolerance: 0.8,
      deadlineMinutes: 10,
      mevProtection: true,
      riskTier: 'normal',
    });

    expect(result.slippageTolerance).toBe(0.8);
    expect(result.deadlineMinutes).toBe(10);
    expect(result.riskTier).toBe('normal');
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO account_settings'),
      [sampleAddress.toLowerCase(), 0.8, 10, true, 'normal', null],
    );
  });

  it('rejects invalid slippage values', async () => {
    await expect(
      service.upsertAccountSettings(sampleAddress, { slippageTolerance: 55 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.upsertAccountSettings(sampleAddress, { slippageTolerance: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid risk tier', async () => {
    await expect(
      service.upsertAccountSettings(sampleAddress, { riskTier: 'ultra_yolo' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
