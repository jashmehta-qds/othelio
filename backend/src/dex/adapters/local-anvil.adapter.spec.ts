import { describe, expect, it } from 'vitest';
import { LocalAnvilAdapter } from './local-anvil.adapter';

describe('LocalAnvilAdapter', () => {
  it('converts USDC input into price-adjusted 18-decimal stock units', async () => {
    const quote = await new LocalAnvilAdapter().getQuote({
      chainId: 31337,
      sellToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      buyToken: '0xB200000000000000000000Ab99cFa739E253872B',
      sellAmount: '111000000',
      takerAddress: '0x1111111111111111111111111111111111111111',
      slippageBps: 50,
    });

    expect(quote?.expectedBuyAmount).toBe(267_341_040_462_427_745n);
    expect(quote?.minBuyAmount).toBe(266_004_335_260_115_606n);
    expect(quote?.dexCalldata).not.toBe('0x');
  });

  it('converts stock-to-stock quantities using both local asset prices', async () => {
    const quote = await new LocalAnvilAdapter().getQuote({
      chainId: 31337,
      sellToken: '0xb2000000000000000000004884b426556b92883d',
      buyToken: '0xB200000000000000000000Ab99cFa739E253872B',
      sellAmount: '1000000000000000000',
      takerAddress: '0x1111111111111111111111111111111111111111',
      slippageBps: 50,
    });

    expect(quote?.expectedBuyAmount).toBe(325_144_508_670_520_231n);
    expect(quote?.minBuyAmount).toBe(323_518_786_127_167_629n);
  });
});
