import { describe, expect, it } from 'vitest';
import { AerodromeAdapter } from './aerodrome.adapter';

describe('AerodromeAdapter Base environments', () => {
  it('supports only the Base fork and Base mainnet', () => {
    expect(new AerodromeAdapter().supportedChainIds).toEqual([31337, 8453]);
  });

  it('does not quote unsupported networks', async () => {
    await expect(new AerodromeAdapter().getQuote({
      chainId: 84532,
      sellToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      buyToken: '0xb200000000000000000000C2e324d24d7eEcd1fb',
      sellAmount: '1000000',
      takerAddress: '0x1111111111111111111111111111111111111111',
      slippageBps: 100,
    })).resolves.toBeNull();
  });
});
