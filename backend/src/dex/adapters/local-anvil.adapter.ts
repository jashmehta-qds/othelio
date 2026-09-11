import { Injectable } from '@nestjs/common';
import { encodeFunctionData, isAddress, parseAbi } from 'viem';
import { IDexAdapter, SwapQuoteParams, SwapQuoteResult } from '../interfaces/dex-adapter.interface';
import { getLocalAssetMarket } from '../local-anvil-market';

const MOCK_DEX_ABI = parseAbi([
  'function swap(address tokenIn,address tokenOut,address safe,uint256 amountIn,uint256 amountOut)',
]);

const LOCAL_ROUTER = '0xBD606f1dAE0285D55113eFC11501677B2221A4dd';
@Injectable()
export class LocalAnvilAdapter implements IDexAdapter {
  readonly name = 'LocalAnvil' as const;
  readonly supportedChainIds = [31337];

  async getQuote(params: SwapQuoteParams): Promise<SwapQuoteResult | null> {
    const routerAddress = process.env.ANVIL_DEX_ROUTER_ADDRESS || LOCAL_ROUTER;
    if (!isAddress(routerAddress)) return null;

    const sellMarket = getLocalAssetMarket(params.sellToken);
    const buyMarket = getLocalAssetMarket(params.buyToken);
    if (!sellMarket || !buyMarket) return null;
    const expectedBuyAmount = (
      BigInt(params.sellAmount) * sellMarket.priceUsdE8 * 10n ** BigInt(buyMarket.decimals)
    ) / (10n ** BigInt(sellMarket.decimals) * buyMarket.priceUsdE8);
    const minBuyAmount = (expectedBuyAmount * BigInt(10_000 - params.slippageBps)) / 10_000n;
    const dexCalldata = encodeFunctionData({
      abi: MOCK_DEX_ABI,
      functionName: 'swap',
      args: [
        params.sellToken as `0x${string}`,
        params.buyToken as `0x${string}`,
        params.takerAddress as `0x${string}`,
        BigInt(params.sellAmount),
        expectedBuyAmount,
      ],
    });

    return {
      providerName: this.name,
      chainId: params.chainId,
      sellToken: params.sellToken,
      buyToken: params.buyToken,
      sellAmount: BigInt(params.sellAmount),
      routerAddress,
      allowanceSpender: routerAddress,
      recipientAddress: params.takerAddress,
      dexCalldata,
      expectedBuyAmount,
      minBuyAmount,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      estimatedGasUsd: 0,
      netBuyAmountUsd: Number(params.sellAmount) / 1e6,
      isAvailable: true,
    };
  }
}
