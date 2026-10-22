import { describe, expect, it, vi } from 'vitest';
import { SettingsController } from './settings.controller';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

describe('SettingsController security', () => {
  const mockSettingsService = {
    getAccountSettings: vi.fn(),
    upsertAccountSettings: vi.fn(),
  };

  const mockAuthService = {
    verifySessionToken: vi.fn(),
  };

  const mockAgentSettingsService = {
    getAgentSettings: vi.fn(),
    upsertAgentSettings: vi.fn(),
    generateApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
  };

  const controller = new SettingsController(
    mockSettingsService as never,
    mockAuthService as never,
    mockAgentSettingsService as never,
  );

  const addressAlice = '0x1111111111111111111111111111111111111111';
  const addressBob = '0x2222222222222222222222222222222222222222';

  it('rejects unauthenticated PUT requests without token', async () => {
    await expect(
      controller.updateSettings(addressAlice, undefined, { slippageTolerance: 1.0 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects PUT requests where token belongs to another address (Bob tampering with Alice)', async () => {
    // Bob's token
    mockAuthService.verifySessionToken.mockReturnValueOnce({
      sub: addressBob.toLowerCase(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    // Bob trying to update Alice's settings
    await expect(
      controller.updateSettings(addressAlice, 'Bearer bob-token', { slippageTolerance: 5.0 }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mockSettingsService.upsertAccountSettings).not.toHaveBeenCalled();
  });

  it('allows authenticated updates when token matches target address', async () => {
    mockAuthService.verifySessionToken.mockReturnValueOnce({
      sub: addressAlice.toLowerCase(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockSettingsService.upsertAccountSettings.mockResolvedValueOnce({
      accountAddress: addressAlice.toLowerCase(),
      slippageTolerance: 0.5,
    });

    const res = await controller.updateSettings(addressAlice, 'Bearer valid-alice-token', { slippageTolerance: 0.5 });
    expect(res.success).toBe(true);
    expect(mockSettingsService.upsertAccountSettings).toHaveBeenCalledWith(addressAlice, { slippageTolerance: 0.5 });
  });
});
