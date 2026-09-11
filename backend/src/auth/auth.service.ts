import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { addressSchema } from '@othelio/shared';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { verifyMessage, recoverMessageAddress, getAddress } from 'viem';

interface NonceEntry {
  nonce: string;
  address: string;
  expiresAt: number;
}

export interface SessionTokenPayload {
  sub: string; // wallet address
  iat: number;
  exp: number;
}

@Injectable()
export class AuthService {
  private readonly secret = process.env.AUTH_SECRET || 'othelio-session-secret-key-1337';
  private readonly nonces = new Map<string, NonceEntry>();

  private cleanExpiredNonces() {
    const now = Date.now();
    for (const [nonceKey, entry] of this.nonces.entries()) {
      if (now > entry.expiresAt) {
        this.nonces.delete(nonceKey);
      }
    }
  }

  generateNonce(rawAddress: string): { nonce: string; message: string; expiresAt: string } {
    this.cleanExpiredNonces();

    const address = addressSchema.parse(rawAddress).toLowerCase();
    const nonce = randomBytes(16).toString('hex');
    const expiresAtMs = Date.now() + 10 * 60 * 1000; // 10 minutes
    const issuedAt = new Date().toISOString();

    // Store keyed by nonce to avoid race conditions when multiple challenges are requested
    this.nonces.set(nonce, {
      nonce,
      address,
      expiresAt: expiresAtMs,
    });

    const message = [
      'Welcome to Othelio!',
      '',
      'Please sign this message to authenticate your session to manage account preferences.',
      'This request will not trigger a blockchain transaction or cost any gas fees.',
      '',
      `Wallet: ${address}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`,
    ].join('\n');

    return {
      nonce,
      message,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async verifySignature(
    rawAddress: string,
    message: string,
    signature: string,
  ): Promise<{ token: string; expiresAt: string }> {
    this.cleanExpiredNonces();

    const address = addressSchema.parse(rawAddress).toLowerCase();

    // Extract nonce from the signed message
    const nonceMatch = message.match(/Nonce:\s*([a-fA-F0-9]+)/i);
    if (!nonceMatch) {
      throw new BadRequestException('Malformed challenge message: nonce not found.');
    }
    const extractedNonce = nonceMatch[1].toLowerCase();
    const entry = this.nonces.get(extractedNonce);

    if (!entry) {
      throw new BadRequestException('Authentication challenge expired or not found. Please request a new nonce.');
    }

    if (Date.now() > entry.expiresAt) {
      this.nonces.delete(extractedNonce);
      throw new BadRequestException('Authentication challenge has expired. Please request a new nonce.');
    }

    if (entry.address.toLowerCase() !== address) {
      throw new BadRequestException('Challenge was issued for a different wallet address.');
    }

    // Verify cryptographic signature
    let isValid = false;
    let checksumAddr: `0x${string}`;
    try {
      checksumAddr = getAddress(address);
    } catch {
      checksumAddr = address as `0x${string}`;
    }

    // 1. Try standard viem verifyMessage
    try {
      isValid = await verifyMessage({
        address: checksumAddr,
        message,
        signature: signature as `0x${string}`,
      });
    } catch {
      isValid = false;
    }

    // 2. Fallback: recover message address directly
    if (!isValid) {
      try {
        const recovered = await recoverMessageAddress({
          message,
          signature: signature as `0x${string}`,
        });
        isValid = recovered.toLowerCase() === address;
      } catch {
        isValid = false;
      }
    }

    // 3. Fallback: line-break normalized check (in case client/browser converted \r\n to \n or vice versa)
    if (!isValid) {
      try {
        const normalized = message.replace(/\r\n/g, '\n');
        const recovered = await recoverMessageAddress({
          message: normalized,
          signature: signature as `0x${string}`,
        });
        isValid = recovered.toLowerCase() === address;
      } catch {
        isValid = false;
      }
    }

    if (!isValid) {
      throw new UnauthorizedException('Invalid cryptographic signature for wallet address.');
    }

    // Consume nonce to prevent replay
    this.nonces.delete(extractedNonce);

    return this.createSessionToken(address);
  }

  createSessionToken(address: string, ttlSeconds = 86400): { token: string; expiresAt: string } {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + ttlSeconds;
    const payload: SessionTokenPayload = {
      sub: address.toLowerCase(),
      iat: now,
      exp,
    };

    const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    const token = `${headerB64}.${payloadB64}.${signature}`;
    return {
      token,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  verifySessionToken(token: string): SessionTokenPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Malformed authorization token');
    }

    const [headerB64, payloadB64, signature] = parts;
    const expectedSig = createHmac('sha256', this.secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new UnauthorizedException('Invalid token signature');
    }

    let payload: SessionTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Invalid token payload');
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new UnauthorizedException('Session token has expired. Please sign in again.');
    }

    return payload;
  }
}
