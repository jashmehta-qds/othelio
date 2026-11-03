import { beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { privateKeyToAccount } from 'viem/accounts';
import { AdminAuthService } from './admin-auth.service';

describe('AdminAuthService', () => {
  let service: AdminAuthService;
  // Anvil test account #0
  const ownerPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const ownerAccount = privateKeyToAccount(ownerPrivateKey);
  const ownerAddress = ownerAccount.address;

  // Other account (non-owner)
  const otherPrivateKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
  const otherAccount = privateKeyToAccount(otherPrivateKey);
  const otherAddress = otherAccount.address;

  beforeEach(() => {
    process.env.ADMIN_WALLETS = ownerAddress.toLowerCase();
    service = new AdminAuthService();
  });

  it('generates an admin challenge nonce with expected message structure', () => {
    const res = service.generateChallenge(ownerAddress, 8453);
    expect(res.nonce).toBeDefined();
    expect(res.nonce.length).toBe(32);
    expect(res.message).toContain('Welcome to Othelio Admin Console!');
    expect(res.message).toContain(`Operator Wallet: ${ownerAddress.toLowerCase()}`);
    expect(res.message).toContain('Chain ID: 8453');
    expect(res.message).toContain(`Nonce: ${res.nonce}`);
  });

  it('verifies valid signature from owner and returns session token', async () => {
    const { message } = service.generateChallenge(ownerAddress, 8453);
    const signature = await ownerAccount.signMessage({ message });

    const result = await service.verifyChallenge(ownerAddress, message, signature, 8453);
    expect(result.token).toBeDefined();
    expect(result.expiresAt).toBeDefined();
    expect(result.isOwner).toBe(true);
    expect(result.address).toBe(ownerAddress.toLowerCase());

    const payload = service.verifySessionToken(result.token);
    expect(payload.sub).toBe(ownerAddress.toLowerCase());
    expect(payload.role).toBe('admin');
    expect(payload.chainId).toBe(8453);
  });

  it('prevents nonce replay attacks', async () => {
    const { message } = service.generateChallenge(ownerAddress, 8453);
    const signature = await ownerAccount.signMessage({ message });

    // First attempt succeeds
    await service.verifyChallenge(ownerAddress, message, signature, 8453);

    // Second attempt fails
    await expect(service.verifyChallenge(ownerAddress, message, signature, 8453)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects verification if chainId does not match expected chainId', async () => {
    const { message } = service.generateChallenge(ownerAddress, 8453);
    const signature = await ownerAccount.signMessage({ message });

    await expect(service.verifyChallenge(ownerAddress, message, signature, 31337)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invalid signature signed by a different wallet', async () => {
    const { message } = service.generateChallenge(ownerAddress, 8453);
    const invalidSignature = await otherAccount.signMessage({ message });

    await expect(service.verifyChallenge(ownerAddress, message, invalidSignature, 8453)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a valid signature from a non-owner address', async () => {
    const { message } = service.generateChallenge(otherAddress, 8453);
    const signature = await otherAccount.signMessage({ message });

    await expect(service.verifyChallenge(otherAddress, message, signature, 8453)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired challenge', async () => {
    const { message, nonce } = service.generateChallenge(ownerAddress, 8453);
    const signature = await ownerAccount.signMessage({ message });

    // Manually expire nonce
    const noncesMap = (service as any).nonces as Map<string, any>;
    const entry = noncesMap.get(nonce);
    if (entry) {
      entry.expiresAt = Date.now() - 1000;
    }

    await expect(service.verifyChallenge(ownerAddress, message, signature, 8453)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects tampered session token', () => {
    const { token } = service.createSessionToken(ownerAddress, 8453);
    const tampered = token.slice(0, -6) + 'xxxxxx';
    expect(() => service.verifySessionToken(tampered)).toThrow(UnauthorizedException);
  });

  it('rejects expired session token', () => {
    const { token } = service.createSessionToken(ownerAddress, 8453, -10); // expired 10s ago
    expect(() => service.verifySessionToken(token)).toThrow(UnauthorizedException);
  });

  it('rechecks onchain owner authority and rejects revoked owner', async () => {
    // Initially owner
    await expect(service.checkOnchainOwner(ownerAddress, 8453)).resolves.not.toThrow();

    // Owner revoked
    process.env.ADMIN_WALLETS = '0x0000000000000000000000000000000000000001';
    await expect(service.checkOnchainOwner(ownerAddress, 8453)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
