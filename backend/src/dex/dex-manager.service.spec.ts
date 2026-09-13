import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DexManagerService } from './dex-manager.service';

describe('DexManagerService route availability', () => {
  it('uses only Aerodrome for Base production routes', async () => {
    const aerodrome = { name: 'Aerodrome', supportedChainIds: [8453], getQuote: vi.fn().mockResolvedValue(null) };
    const manager = new DexManagerService(
      { query: vi.fn() } as never,
      aerodrome as never,
    );

    await expect(manager.getBestQuote({
      chainId: 8453,
      sellToken: '0x1111111111111111111111111111111111111111',
      buyToken: '0x2222222222222222222222222222222222222222',
      sellAmount: '1',
      takerAddress: '0x3333333333333333333333333333333333333333',
      slippageBps: 50,
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(aerodrome.getQuote).toHaveBeenCalledTimes(1);
  });
});
