import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DexManagerService } from './dex-manager.service';

describe('DexManagerService route availability', () => {
  it('does not turn a fallback estimate into executable calldata', async () => {
    const unavailable = { name: '0x', supportedChainIds: [8453], getQuote: vi.fn().mockResolvedValue(null) };
    const oneInch = { name: '1inch', supportedChainIds: [8453], getQuote: vi.fn().mockResolvedValue(null) };
    const aerodrome = { name: 'Aerodrome', supportedChainIds: [8453], getQuote: vi.fn().mockResolvedValue(null) };
    const localAnvil = { name: 'LocalAnvil', supportedChainIds: [31337], getQuote: vi.fn().mockResolvedValue(null) };
    const fallback = { name: 'Fallback', supportedChainIds: [8453], getQuote: vi.fn().mockResolvedValue(null) };
    const manager = new DexManagerService(
      { query: vi.fn() } as never,
      unavailable as never,
      oneInch as never,
      aerodrome as never,
      localAnvil as never,
      fallback as never,
    );

    await expect(manager.getBestQuote({
      chainId: 8453,
      sellToken: '0x1111111111111111111111111111111111111111',
      buyToken: '0x2222222222222222222222222222222222222222',
      sellAmount: '1',
      takerAddress: '0x3333333333333333333333333333333333333333',
      slippageBps: 50,
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fallback.getQuote).toHaveBeenCalledTimes(1);
  });
});
