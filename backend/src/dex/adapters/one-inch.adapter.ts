import { Injectable } from '@nestjs/common';
import { isAddress } from 'viem';
import { IDexAdapter, SwapQuoteParams, SwapQuoteResult } from '../interfaces/dex-adapter.interface';

@Injectable()
export class OneInchAdapter implements IDexAdapter {
  readonly name = '1inch' as const;
  readonly supportedChainIds = [8453, 1, 42161, 10]; // Base, Mainnet, Arbitrum, Optimism

  async getQuote(params: SwapQuoteParams): Promise<SwapQuoteResult | null> {
    const apiKey = process.env.ONEINCH_API_KEY;
    if (!apiKey) return null;

    try {
      const slippagePct = (params.slippageBps / 100).toFixed(2);
      const url = `https://api.1inch.dev/swap/v6.0/${params.chainId}/swap?src=${params.sellToken}&dst=${params.buyToken}&amount=${params.sellAmount}&from=${params.takerAddress}&slippage=${slippagePct}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!res.ok) return null;
      const json = await res.json();

      const routerAddress = json.tx?.to;
      const dexCalldata = json.tx?.data;
      const expectedBuyAmount = BigInt(json.dstAmount || '0');
      if (
        !isAddress(routerAddress)
        || typeof dexCalldata !== 'string'
        || !/^0x(?:[a-fA-F0-9]{2})+$/.test(dexCalldata)
        || expectedBuyAmount <= 0n
      ) {
        return null;
      }
      const estimatedGas = Number(json.tx?.gas || '140000');
      const estimatedGasUsd = Number(((estimatedGas * 0.00000005 * 2500)).toFixed(4)) || 0.06;

      const buyAmountNumber = Number(expectedBuyAmount) / 1e6;
      const netBuyAmountUsd = Math.max(0, buyAmountNumber - estimatedGasUsd);

      return {
        providerName: '1inch',
        chainId: params.chainId,
        sellToken: params.sellToken,
        buyToken: params.buyToken,
        sellAmount: BigInt(params.sellAmount),
        routerAddress,
        allowanceSpender: routerAddress,
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
      console.warn('[OneInchAdapter] Quote error:', err);
      return null;
    }
  }
}
