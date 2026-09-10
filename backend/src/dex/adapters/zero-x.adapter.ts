import { Injectable } from '@nestjs/common';
import { isAddress } from 'viem';
import { IDexAdapter, SwapQuoteParams, SwapQuoteResult } from '../interfaces/dex-adapter.interface';

@Injectable()
export class ZeroXAdapter implements IDexAdapter {
  readonly name = '0x' as const;
  readonly supportedChainIds = [8453, 1]; // Base & Ethereum Mainnet

  async getQuote(params: SwapQuoteParams): Promise<SwapQuoteResult | null> {
    const apiKey = process.env.ZEROX_API_KEY;
    if (!apiKey) return null;

    try {
      const url = `https://api.0x.org/swap/v1/quote?buyToken=${params.buyToken}&sellToken=${params.sellToken}&sellAmount=${params.sellAmount}&takerAddress=${params.takerAddress}`;
      const res = await fetch(url, {
        headers: { '0x-api-key': apiKey },
      });

      if (!res.ok) return null;
      const json = await res.json();

      const routerAddress = json.to;
      const allowanceSpender = json.allowanceTarget;
      const dexCalldata = json.data;
      const expectedBuyAmount = BigInt(json.buyAmount || '0');
      if (
        !isAddress(routerAddress)
        || !isAddress(allowanceSpender)
        || typeof dexCalldata !== 'string'
        || !/^0x(?:[a-fA-F0-9]{2})+$/.test(dexCalldata)
        || expectedBuyAmount <= 0n
      ) {
        return null;
      }
      const estimatedGas = Number(json.estimatedGas || '150000');
      const gasPriceGwei = Number(json.gasPrice || '100000000') / 1e9;
      // Est gas fee in USD (~ $0.08 default on Base)
      const estimatedGasUsd = Number(((estimatedGas * gasPriceGwei * 2500) / 1e9).toFixed(4)) || 0.08;

      const buyAmountNumber = Number(expectedBuyAmount) / 1e6; // USDC normalized scale
      const netBuyAmountUsd = Math.max(0, buyAmountNumber - estimatedGasUsd);

      return {
        providerName: '0x',
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
      console.warn('[ZeroXAdapter] Quote error:', err);
      return null;
    }
  }
}
