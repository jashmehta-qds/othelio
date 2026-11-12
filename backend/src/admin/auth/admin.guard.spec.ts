import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

function contextFor(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe('AdminGuard', () => {
  const authService = {
    verifySessionToken: vi.fn(() => ({ sub: '0xowner', chainId: 8453 })),
    checkOnchainOwner: vi.fn(async () => undefined),
  };

  it('rejects a query for a chain different from the signed-in chain', async () => {
    const guard = new AdminGuard(authService as any);
    await expect(guard.canActivate(contextFor({
      headers: { authorization: 'Bearer token' },
      query: { chainId: '31337' },
      body: {},
    }))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authService.checkOnchainOwner).not.toHaveBeenCalled();
  });

  it('allows the signed-in chain and rechecks the onchain owner', async () => {
    const guard = new AdminGuard(authService as any);
    const request: any = {
      headers: { authorization: 'Bearer token' },
      query: {},
      body: { chainId: 8453 },
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(authService.checkOnchainOwner).toHaveBeenCalledWith('0xowner', 8453);
    expect(request.adminUser).toEqual({ address: '0xowner', chainId: 8453 });
  });
});
