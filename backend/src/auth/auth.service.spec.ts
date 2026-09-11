import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.service';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { privateKeyToAccount } from 'viem/accounts';

describe('AuthService', () => {
  const service = new AuthService();
  // Anvil test account #0
  const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const account = privateKeyToAccount(privateKey);
  const address = account.address;

  it('generates a nonce challenge for an address', () => {
    const res = service.generateNonce(address);
    expect(res.nonce).toBeDefined();
    expect(res.nonce.length).toBe(32);
    expect(res.message).toContain(`Wallet: ${address.toLowerCase()}`);
    expect(res.message).toContain(`Nonce: ${res.nonce}`);
  });

  it('verifies a valid signature and returns a session token', async () => {
    const { message } = service.generateNonce(address);
    const signature = await account.signMessage({ message });

    const result = await service.verifySignature(address, message, signature);
    expect(result.token).toBeDefined();
    expect(result.expiresAt).toBeDefined();

    // Verify session token decoding
    const decoded = service.verifySessionToken(result.token);
    expect(decoded.sub).toBe(address.toLowerCase());
    expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('prevents nonce replay attacks', async () => {
    const { message } = service.generateNonce(address);
    const signature = await account.signMessage({ message });

    // First attempt succeeds
    await service.verifySignature(address, message, signature);

    // Second attempt fails because nonce was consumed
    await expect(service.verifySignature(address, message, signature)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invalid signature from a different account', async () => {
    const otherAccount = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
    const { message } = service.generateNonce(address);
    // signed with otherAccount instead of account
    const invalidSignature = await otherAccount.signMessage({ message });

    await expect(service.verifySignature(address, message, invalidSignature)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects tampered session tokens', () => {
    const { token } = service.createSessionToken(address);
    const tampered = token.slice(0, -5) + 'xxxxx';
    expect(() => service.verifySessionToken(tampered)).toThrow(UnauthorizedException);
  });
});
