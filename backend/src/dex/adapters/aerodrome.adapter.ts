import { Injectable } from '@nestjs/common';
import { createPublicClient, encodePacked, http, isAddress, parseAbi } from 'viem';
import { AerodromeRouteKind, IDexAdapter, SwapQuoteParams, SwapQuoteResult } from '../interfaces/dex-adapter.interface';
import {
  BASE_AERODROME_SLIPSTREAM_ROUTER,
  BASE_USDC_ADDRESS,
  getAerodromeSlipstreamRoute,
  getAerodromeSlipstreamRoutes,
} from '../aerodrome-slipstream-routes';
import { rpcUrlForChain } from '../../config/network-runtime';

const AERODROME_QUOTER_ADDRESS = '0x514c8B5f54112481E28028F1166Bd78501089259' as const;
const AERODROME_QUOTER_ABI = parseAbi([
  'function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
]);

@Injectable()
export class AerodromeAdapter implements IDexAdapter {
  readonly name = 'Aerodrome' as const;
  readonly supportedChainIds = [31337, 8453];

  async getQuote(params: SwapQuoteParams): Promise<SwapQuoteResult | null> {
    try {
      if (params.sellToken.toLowerCase() === params.buyToken.toLowerCase()) return null;

      if (params.chainId !== 31337 && params.chainId !== 8453) return null;

      const isUsdcIn = params.sellToken.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase();
      const isUsdcOut = params.buyToken.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase();

      const candidatePaths: Array<{
        kind: AerodromeRouteKind;
        firstTickSpacing: number;
        secondTickSpacing: number;
        path: `0x${string}`;
      }> = [];

      if (isUsdcIn || isUsdcOut) {
        const directRoutes = getAerodromeSlipstreamRoutes(params.chainId, params.sellToken, params.buyToken);
        for (const r of directRoutes) {
          candidatePaths.push({
            kind: 'DIRECT',
            firstTickSpacing: r.tickSpacing,
            secondTickSpacing: 0,
            path: encodePacked(
              ['address', 'int24', 'address'],
              [params.sellToken as `0x${string}`, r.tickSpacing, params.buyToken as `0x${string}`],
            ),
          });
        }
      } else {
        const directRoutes = getAerodromeSlipstreamRoutes(params.chainId, params.sellToken, params.buyToken);
        for (const r of directRoutes) {
          candidatePaths.push({
            kind: 'DIRECT',
            firstTickSpacing: r.tickSpacing,
            secondTickSpacing: 0,
            path: encodePacked(
              ['address', 'int24', 'address'],
              [params.sellToken as `0x${string}`, r.tickSpacing, params.buyToken as `0x${string}`],
            ),
          });
        }

        const leg1Routes = getAerodromeSlipstreamRoutes(params.chainId, params.sellToken, BASE_USDC_ADDRESS);
        const leg2Routes = getAerodromeSlipstreamRoutes(params.chainId, BASE_USDC_ADDRESS, params.buyToken);

        for (const l1 of leg1Routes) {
          for (const l2 of leg2Routes) {
            candidatePaths.push({
              kind: 'VIA_USDC',
              firstTickSpacing: l1.tickSpacing,
              secondTickSpacing: l2.tickSpacing,
              path: encodePacked(
                ['address', 'int24', 'address', 'int24', 'address'],
                [
                  params.sellToken as `0x${string}`,
                  l1.tickSpacing,
                  BASE_USDC_ADDRESS as `0x${string}`,
                  l2.tickSpacing,
                  params.buyToken as `0x${string}`,
                ],
              ),
            });
          }
        }
      }

      if (candidatePaths.length === 0) {
        console.warn('[AerodromeAdapter] no reviewed route manifest entry', {
          chainId: params.chainId,
          sellToken: params.sellToken,
          buyToken: params.buyToken,
        });
        return null;
      }

      const rpcUrl = rpcUrlForChain(params.chainId);
      if (!rpcUrl) throw new Error(`RPC is required for Aerodrome quotes on chain ${params.chainId}.`);
      const client = createPublicClient({ transport: http(rpcUrl) });

      let bestResult: {
        kind: AerodromeRouteKind;
        firstTickSpacing: number;
        secondTickSpacing: number;
        path: `0x${string}`;
        expectedBuyAmount: bigint;
      } | null = null;

      let failedCandidates = 0;
      for (const candidate of candidatePaths) {
        try {
          const res = await client.readContract({
            address: AERODROME_QUOTER_ADDRESS,
            abi: AERODROME_QUOTER_ABI,
            functionName: 'quoteExactInput',
            args: [candidate.path, BigInt(params.sellAmount)],
          });
          const expectedBuyAmount = Array.isArray(res) ? BigInt(res[0]) : BigInt(res as unknown as bigint);
          if (expectedBuyAmount > (bestResult?.expectedBuyAmount ?? 0n)) {
            bestResult = { ...candidate, expectedBuyAmount };
          }
        } catch {
          failedCandidates += 1;
          continue;
        }
      }

      if (!bestResult || bestResult.expectedBuyAmount <= 0n) {
        console.warn('[AerodromeAdapter] all reviewed route quotes failed', {
          chainId: params.chainId,
          sellToken: params.sellToken,
          buyToken: params.buyToken,
          sellAmount: params.sellAmount,
          candidateCount: candidatePaths.length,
          failedCandidates,
          rpcConfigured: Boolean(rpcUrl),
        });
        return null;
      }

      const routerAddress = BASE_AERODROME_SLIPSTREAM_ROUTER;
      const allowanceSpender = BASE_AERODROME_SLIPSTREAM_ROUTER;
      if (
        !isAddress(routerAddress)
        || !isAddress(allowanceSpender)
      ) {
        return null;
      }
      const estimatedGasUsd = 0.04;

      const buyAmountNumber = Number(bestResult.expectedBuyAmount) / 1e6;
      const netBuyAmountUsd = Math.max(0, buyAmountNumber - estimatedGasUsd);

      return {
        providerName: 'Aerodrome',
        kind: bestResult.kind,
        chainId: params.chainId,
        sellToken: params.sellToken,
        buyToken: params.buyToken,
        sellAmount: BigInt(params.sellAmount),
        routerAddress,
        allowanceSpender,
        recipientAddress: params.takerAddress,
        tickSpacing: bestResult.firstTickSpacing,
        firstTickSpacing: bestResult.firstTickSpacing,
        secondTickSpacing: bestResult.secondTickSpacing,
        expectedBuyAmount: bestResult.expectedBuyAmount,
        minBuyAmount: (bestResult.expectedBuyAmount * BigInt(10_000 - params.slippageBps)) / 10_000n,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        estimatedGasUsd,
        netBuyAmountUsd,
        isAvailable: true,
        rawResponse: { path: bestResult.path, quoter: AERODROME_QUOTER_ADDRESS },
      };
    } catch (err) {
      console.warn('[AerodromeAdapter] quote request failed', {
        chainId: params.chainId,
        sellToken: params.sellToken,
        buyToken: params.buyToken,
        sellAmount: params.sellAmount,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

}
