import { BadRequestException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { addressSchema } from '@othelio/shared';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createPublicClient, getAddress, http, isAddress, parseAbi } from 'viem';
import { rpcUrlForChain } from '../../config/network-runtime';
import { seriesFactoryAbi } from '@othelio/shared';

interface AdminNonceEntry {
  nonce: string;
  message: string;
  address: string;
  chainId: number;
  expiresAt: number;
}

export interface AdminSessionPayload {
  sub: string; // wallet address
  role: 'admin';
  chainId: number;
  iat: number;
  exp: number;
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly secret = (() => {
    const value = process.env.ADMIN_AUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
    if (process.env.NODE_ENV === 'production' && (!value || value.length < 32)) {
      throw new Error('ADMIN_AUTH_SECRET must contain at least 32 characters in production');
    }
    return value || 'othelio-admin-operator-secret-key-1337';
  })();

  private readonly nonces = new Map<string, AdminNonceEntry>();

  private cleanExpiredNonces() {
    const now = Date.now();
    for (const [nonceKey, entry] of this.nonces.entries()) {
      if (now > entry.expiresAt) {
        this.nonces.delete(nonceKey);
      }
    }
  }

  getFactoryAddress(chainId: number): `0x${string}` {
    const configuredChain = process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined;
    if (configuredChain !== undefined && chainId !== configuredChain) {
      throw new ServiceUnavailableException(
        `Risk Split factory is not configured for chain ${chainId} (backend configured for chain ${configuredChain}). Set RISK_SPLIT_FACTORY_ADDRESS.`,
      );
    }
    const envAddr = process.env.RISK_SPLIT_FACTORY_ADDRESS?.trim();
    if (envAddr && isAddress(envAddr) && !/^0x0{40}$/i.test(envAddr)) {
      return getAddress(envAddr);
    }
    throw new ServiceUnavailableException(`Risk Split factory is not configured for chain ${chainId}. Set RISK_SPLIT_FACTORY_ADDRESS.`);
  }

  generateChallenge(rawAddress: string, chainIdInput = 8453): { nonce: string; message: string; expiresAt: string } {
    this.cleanExpiredNonces();

    const address = addressSchema.parse(rawAddress).toLowerCase();
    const chainId = Number(chainIdInput);
    const nonce = randomBytes(16).toString('hex');
    const expiresAtMs = Date.now() + 10 * 60 * 1000; // 10 minutes
    const issuedAt = new Date().toISOString();

    const message = [
      'Welcome to Othelio Admin Console!',
      '',
      'Please sign this message to authenticate your operator session.',
      'This action does not execute any transactions or cost any gas.',
      '',
      `Operator Wallet: ${address}`,
      `Chain ID: ${chainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`,
    ].join('\n');

    this.nonces.set(nonce, {
      nonce,
      message,
      address,
      chainId,
      expiresAt: expiresAtMs,
    });

    return {
      nonce,
      message,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async verifyChallenge(
    rawAddress: string,
    message: string,
    signature: string,
    expectedChainId?: number,
  ): Promise<{ token: string; expiresAt: string; isOwner: boolean; address: string; factoryAddress: string }> {
    this.cleanExpiredNonces();

    const address = addressSchema.parse(rawAddress).toLowerCase();

    // 1. Extract and validate nonce
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

    if (message !== entry.message) {
      throw new BadRequestException('Challenge message does not match the issued message.');
    }

    // 2. Validate chain ID
    const chainMatch = message.match(/Chain ID:\s*(\d+)/i);
    const messageChainId = chainMatch ? Number(chainMatch[1]) : entry.chainId;
    if (expectedChainId !== undefined && messageChainId !== Number(expectedChainId)) {
      throw new BadRequestException(`Challenge chain ID mismatch: expected ${expectedChainId}, got ${messageChainId}`);
    }

    // 3. Cryptographic signature check
    const { verifyMessage, recoverMessageAddress } = await import('viem');
    let isValid = false;
    let checksumAddr: `0x${string}`;
    try {
      checksumAddr = getAddress(address);
    } catch {
      checksumAddr = address as `0x${string}`;
    }

    try {
      isValid = await verifyMessage({
        address: checksumAddr,
        message,
        signature: signature as `0x${string}`,
      });
    } catch {
      isValid = false;
    }

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

    // Nonce consumed to prevent replay attacks
    this.nonces.delete(extractedNonce);

    // 4. Verify configured deployment and onchain owner authority
    const factoryAddress = this.getFactoryAddress(messageChainId);
    const isOwner = await this.isOwner(address, messageChainId);
    if (!isOwner) {
      throw new UnauthorizedException('Wallet address is not an authorized operator or onchain owner.');
    }

    const session = this.createSessionToken(address, messageChainId);

    return {
      token: session.token,
      expiresAt: session.expiresAt,
      isOwner: true,
      address,
      factoryAddress,
    };
  }

  async isOwner(address: string, chainId: number): Promise<boolean> {
    const targetAddr = address.toLowerCase();
    const factoryAddress = this.getFactoryAddress(chainId);
    // The onchain owner is the sole authority; environment allowlists cannot grant it.
    try {
      const rpcUrl = rpcUrlForChain(chainId);
      if (!rpcUrl) throw new Error(`No RPC configured for chain ${chainId}`);

      const client = createPublicClient({ transport: http(rpcUrl) });
      const onchainOwner = await client.readContract({
        address: factoryAddress,
        abi: seriesFactoryAbi,
        functionName: 'owner',
      });

      return (onchainOwner as string).toLowerCase() === targetAddr;
    } catch (err) {
      this.logger.warn(`Could not verify onchain owner for ${targetAddr} on chain ${chainId} at ${factoryAddress}: ${err}`);
      throw new ServiceUnavailableException(
        `Cannot verify factory owner onchain on chain ${chainId} at ${factoryAddress}. Check the configured factory and RPC.`,
      );
    }
  }

  async checkOnchainOwner(address: string, chainId: number): Promise<void> {
    const authorized = await this.isOwner(address, chainId);
    if (!authorized) {
      throw new UnauthorizedException('Operator authority revoked or wallet is not onchain owner.');
    }
  }

  createSessionToken(address: string, chainId: number, ttlSeconds = 86400): { token: string; expiresAt: string } {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + ttlSeconds;
    const payload: AdminSessionPayload = {
      sub: address.toLowerCase(),
      role: 'admin',
      chainId,
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

  verifySessionToken(token: string): AdminSessionPayload {
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

    let payload: AdminSessionPayload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Invalid token payload');
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new UnauthorizedException('Session token has expired. Please sign in again.');
    }

    if (payload.role !== 'admin') {
      throw new UnauthorizedException('Token is not an admin session token.');
    }

    return payload;
  }
}
