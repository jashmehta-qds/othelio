import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminGuard, RequireAdminOwner } from './admin.guard';
import { AdminMarketsController } from '../markets/admin-markets.controller';

function contextFor(request: Record<string, unknown>, handler: (...args: never[]) => unknown = () => {}) {
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe('AdminGuard', () => {
  const authService = {
    verifySessionToken: vi.fn(() => ({ sub: '0xowner', chainId: 8453 })),
    checkOnchainOwner: vi.fn(async () => ({
      address: '0xowner', chainId: 8453, capabilities: { upside: true, riskSplit: false, assetRegistry: false },
    })),
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
    expect(request.adminUser).toMatchObject({ address: '0xowner', chainId: 8453 });
  });

  it('does not grant permission to preview registry actions to an Upside-only owner', async () => {
    const handler = () => {};
    RequireAdminOwner('assetRegistry')(Object, 'preview', { value: handler });
    const guard = new AdminGuard(authService as any);
    await expect(guard.canActivate(contextFor({
      headers: { authorization: 'Bearer token' }, body: {},
    }, handler))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not let a valid query chain override a conflicting body chain', async () => {
    const guard = new AdminGuard(authService as any);
    await expect(guard.canActivate(contextFor({
      headers: { authorization: 'Bearer token' }, query: { chainId: '8453' }, body: { chainId: 31337 },
    }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each(['previewMarket', 'previewSetup'] as const)('restricts %s to the Risk Split factory owner', async (method) => {
    const guard = new AdminGuard(authService as any);
    await expect(guard.canActivate(contextFor({
      headers: { authorization: 'Bearer token' }, body: {},
    }, AdminMarketsController.prototype[method]))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
