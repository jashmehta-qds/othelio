import { Injectable } from '@nestjs/common';
import { isAddress } from 'viem';
import { IDexAdapter, SwapQuoteParams, SwapQuoteResult } from '../interfaces/dex-adapter.interface';

@Injectable()
export class AerodromeAdapter implements IDexAdapter {
  readonly name = 'Aerodrome' as const;
  readonly supportedChainIds = [8453]; // Base native DEX

  async getQuote(params: SwapQuoteParams): Promise<SwapQuoteResult | null> {
    try {
      const url = `https://api.aerodrome.finance/v1/quote?from=${params.sellToken}&to=${params.buyToken}&amount=${params.sellAmount}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = await res.json();
      if (!json.dstAmount) return null;

      const routerAddress = json.to;
      const allowanceSpender = json.allowanceTarget || json.spender;
      const dexCalldata = json.data;
      const expectedBuyAmount = BigInt(json.dstAmount || '0');
      if (
        !isAddress(routerAddress)
        || !isAddress(allowanceSpender)
        || typeof dexCalldata !== 'string'
        || !/^0x(?:[a-fA-F0-9]{2})+$/.test(dexCalldata)
        || expectedBuyAmount <= 0n
      ) {
        return null;
      }
      const estimatedGasUsd = 0.04; // Native Base pool gas efficiency (~$0.04)

      const buyAmountNumber = Number(expectedBuyAmount) / 1e6;
      const netBuyAmountUsd = Math.max(0, buyAmountNumber - estimatedGasUsd);

      return {
        providerName: 'Aerodrome',
        chainId: params.chainId,
        sellToken: params.sellToken,
        buyToken: params.buyToken,
        sellAmount: BigInt(params.sellAmount),
        routerAddress,
        allowanceSpender,
        recipientAddress: params.takerAddress,
        dexCalldata,
        expectedBuyAmount,
        minBuyAmount: (expectedBuyAmount * BigInt(10_000 - params.slippageBps)) / 10_000n,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        estimatedGasUsd,
        netBuyAmountUsd,
        isAvailable: true,
        rawResponse: json,
      };
    } catch (err) {
      return null;
    }
  }
}
