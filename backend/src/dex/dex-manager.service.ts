import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AerodromeAdapter } from './adapters/aerodrome.adapter';
import { IDexAdapter, SwapQuoteParams, SwapQuoteResult } from './interfaces/dex-adapter.interface';

@Injectable()
export class DexManagerService {
  private readonly adapters: IDexAdapter[];

  constructor(
    @Inject(DatabaseService)
    private readonly db: DatabaseService,
    @Inject(AerodromeAdapter) aerodromeAdapter: AerodromeAdapter,
  ) {
    this.adapters = [aerodromeAdapter];
  }

  async getBestQuote(params: SwapQuoteParams): Promise<{
    winningQuote: SwapQuoteResult;
    allQuotes: SwapQuoteResult[];
  }> {
    const quotePromises = this.adapters.map(async (adapter) => {
      if (!adapter.supportedChainIds.includes(params.chainId)) {
        return null;
      }
      try {
        return await adapter.getQuote(params);
      } catch (err) {
        return null;
      }
    });

    const results = await Promise.all(quotePromises);
    const validQuotes = results.filter((q): q is SwapQuoteResult => (
      q !== null
      && q.isAvailable
      && q.chainId === params.chainId
      && q.sellToken.toLowerCase() === params.sellToken.toLowerCase()
      && q.buyToken.toLowerCase() === params.buyToken.toLowerCase()
      && q.sellAmount === BigInt(params.sellAmount)
      && q.recipientAddress.toLowerCase() === params.takerAddress.toLowerCase()
      && Number.isInteger(q.tickSpacing)
    ));

    if (validQuotes.length === 0) {
      throw new ServiceUnavailableException(
        'No executable DEX route is available for this exact chain, recipient, asset pair, and amount.',
      );
    }

    // Rank quotes by netBuyAmountUsd (buy amount MINUS estimated gas cost)
    validQuotes.sort((a, b) => b.netBuyAmountUsd - a.netBuyAmountUsd);
    const winningQuote = validQuotes[0];

    // Log trade route analytics to PostgreSQL swap_route_logs
    this.logRouteDecision(params, winningQuote, validQuotes).catch((err) =>
      console.warn('[DexManagerService] Route logging warning:', err),
    );

    return {
      winningQuote,
      allQuotes: validQuotes,
    };
  }

  private async logRouteDecision(
    params: SwapQuoteParams,
    winner: SwapQuoteResult,
    allQuotes: SwapQuoteResult[],
  ) {
    try {
      await this.db.query(
        `INSERT INTO swap_route_logs (chain_id, basket_address, action, sell_token, buy_token, sell_amount, winning_provider, winning_router, winning_buy_amount, estimated_gas_usd, net_buy_amount_usd, all_quotes, slippage_bps)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          params.chainId,
          params.takerAddress,
          'MINT',
          params.sellToken,
          params.buyToken,
          params.sellAmount,
          winner.providerName,
          winner.routerAddress,
          winner.expectedBuyAmount.toString(),
          winner.estimatedGasUsd,
          winner.netBuyAmountUsd,
          JSON.stringify(allQuotes.map((q) => ({ provider: q.providerName, netBuyUsd: q.netBuyAmountUsd, gasUsd: q.estimatedGasUsd }))),
          params.slippageBps,
        ],
      );
    } catch (err) {
      console.warn('[DexManagerService] DB log failed:', err);
    }
  }

  async getRouteHistory(basketAddress?: string) {
    try {
      let sql = 'SELECT * FROM swap_route_logs';
      const params: any[] = [];
      if (basketAddress) {
        sql += ' WHERE basket_address = $1';
        params.push(basketAddress.toLowerCase());
      }
      sql += ' ORDER BY created_at DESC LIMIT 50';

      const res = await this.db.query(sql, params);
      return { success: true, data: res.rows };
    } catch (err) {
      return { success: false, data: [] };
    }
  }

  getRegisteredAdapters() {
    return this.adapters.map((a) => ({
      name: a.name,
      supportedChains: a.supportedChainIds,
    }));
  }
}
