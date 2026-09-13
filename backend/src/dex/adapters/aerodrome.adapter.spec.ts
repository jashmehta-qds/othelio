import { CONTRACT_B20_TOKENS } from '@othelio/shared';
import { describe, expect, it, vi } from 'vitest';
import { LOCAL_AERODROME_SLIPSTREAM_ROUTER, BASE_USDC_ADDRESS } from '../aerodrome-slipstream-routes';
import { AerodromeAdapter } from './aerodrome.adapter';

describe('AerodromeAdapter local mock routes', () => {
  it('returns a typed, local-only quote without calling Aerodrome', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const quote = await new AerodromeAdapter().getQuote({
      chainId: 31337,
      sellToken: BASE_USDC_ADDRESS,
      buyToken: CONTRACT_B20_TOKENS[0],
      sellAmount: '1000000',
      takerAddress: '0x1111111111111111111111111111111111111111',
      slippageBps: 100,
    });

    expect(quote).toMatchObject({
      chainId: 31337,
      routerAddress: LOCAL_AERODROME_SLIPSTREAM_ROUTER,
      tickSpacing: 100,
      expectedBuyAmount: 4_454_342_984_409_799n,
      minBuyAmount: 4_409_799_554_565_701n,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
