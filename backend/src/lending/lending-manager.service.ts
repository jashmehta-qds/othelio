import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AaveV3LendingAdapter } from './adapters/aave-v3.adapter';
import { AAVE_V3_POOLS } from './adapters/aave-v3.adapter';
import { ILendingAdapter, LendingQuoteParams, LendingQuoteResult } from './interfaces/lending-adapter.interface';

@Injectable()
export class LendingManagerService {
  private readonly adapters: ILendingAdapter[];

  constructor(
    @Inject(DatabaseService)
    private readonly db: DatabaseService,
    @Inject(AaveV3LendingAdapter) aaveV3Adapter: AaveV3LendingAdapter,
  ) {
    // Only the verified Aave-shaped adapter participates in preparation. Other adapters
    // remain source-only until they have canonical position identity and recovery tests.
    this.adapters = [aaveV3Adapter].filter(Boolean);
  }

  async getBestLendingQuote(params: LendingQuoteParams): Promise<{
    winningQuote: LendingQuoteResult | null;
    allQuotes: LendingQuoteResult[];
  }> {
    this.assertActionCanBePrepared(params);
    const errors: string[] = [];
    const quotePromises = this.adapters.map(async (adapter) => {
      if (!adapter || !adapter.supportedChainIds || !adapter.supportedChainIds.includes(params.chainId)) {
        return null;
      }
      try {
        return await adapter.getQuote(params);
      } catch (err: any) {
        const msg = `${adapter.name}: ${err?.message || String(err)}`;
        console.error('[LendingManagerService] Adapter failed:', msg, err);
        errors.push(msg);
        return null;
      }
    });

    const results = await Promise.all(quotePromises);
    const allFetched = results.filter((q): q is LendingQuoteResult => q !== null);
    const validQuotes = allFetched.filter((q) => q.isAvailable && (
      params.action === 'REPAY' || params.action === 'WITHDRAW' || q.supplyApy > 0 || q.borrowApy > 0
    ));

    if (validQuotes.length === 0) {
      return {
        winningQuote: null,
        allQuotes: allFetched,
      };
    }

    // Sort by best APY depending on action
    if (params.action === 'SUPPLY') {
      validQuotes.sort((a, b) => b.supplyApy - a.supplyApy);
    } else if (params.action === 'BORROW') {
      validQuotes.sort((a, b) => a.borrowApy - b.borrowApy);
    }

    const winningQuote = validQuotes[0];

    // Log lending market decision asynchronously
    this.logLendingDecision(params, winningQuote, validQuotes).catch((err) =>
      console.warn('[LendingManagerService] Logging warning:', err),
    );

    return {
      winningQuote,
      allQuotes: allFetched,
    };
  }

  private assertActionCanBePrepared(params: LendingQuoteParams) {
    if (params.action === 'SUPPLY' || params.action === 'BORROW' || params.action === 'REINVEST') {
      throw new ForbiddenException({
        error: 'ACTION_DISABLED',
        action: params.action,
        reason: `New ${params.action.toLowerCase()} exposure is not offered in the portfolio-only release.`,
        enforcement: { api: true, onchain: false },
        authorityMode: 'UNRESTRICTED_OWNER',
      });
    }

    if (params.action === 'REPAY' || params.action === 'WITHDRAW') {
      const configuredPool = AAVE_V3_POOLS[params.chainId];
      if (!params.protocol || !params.marketAddress) {
        throw new BadRequestException({
          error: 'POSITION_IDENTITY_REQUIRED',
          action: params.action,
          required: ['protocol', 'marketAddress'],
        });
      }
      if (params.protocol !== 'AAVE_V3' || !configuredPool || params.marketAddress.toLowerCase() !== configuredPool.toLowerCase()) {
        throw new BadRequestException({
          error: 'UNSUPPORTED_POSITION_MARKET',
          action: params.action,
          protocol: params.protocol,
          marketAddress: params.marketAddress,
        });
      }
    }
  }

  async getBasketLendingBreakdown(chainId: number, assets: Array<{ address: string; amount?: string }>) {
    const assetQuotes = await Promise.all(
      assets.map(async (asset) => {
        try {
          const res = await this.getBestLendingQuote({
            chainId,
            action: 'SUPPLY',
            assetAddress: asset.address,
            amount: asset.amount || '1000000000000000000',
            safeAddress: '0x0000000000000000000000000000000000000000',
          });
          return {
            assetAddress: asset.address,
            optimalVenue: res.winningQuote,
            allVenues: res.allQuotes,
          };
        } catch (err) {
          return {
            assetAddress: asset.address,
            optimalVenue: null,
            allVenues: [],
            error: String(err),
          };
        }
      }),
    );

    return {
      success: true,
      chainId,
      breakdown: assetQuotes,
    };
  }

  private async logLendingDecision(
    params: LendingQuoteParams,
    winner: LendingQuoteResult,
    allQuotes: LendingQuoteResult[],
  ) {
    try {
      await this.db.query(
        `INSERT INTO lending_market_logs 
         (chain_id, basket_address, action, asset_address, amount, winning_provider, winning_pool, winning_supply_apy, winning_borrow_apy, all_market_quotes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          params.chainId,
          params.safeAddress,
          params.action,
          params.assetAddress,
          params.amount,
          winner.providerName,
          winner.targetPool,
          winner.supplyApy,
          winner.borrowApy,
          JSON.stringify(allQuotes.map((q) => ({ provider: q.providerName, targetPool: q.targetPool, supplyApy: q.supplyApy, borrowApy: q.borrowApy }))),
        ],
      );
    } catch {
      // Ignore DB logging if table is uninitialized
    }
  }

  getRegisteredAdapters() {
    return this.adapters.map((a) => ({
      name: a.name,
      supportedChains: a.supportedChainIds,
    }));
  }

  async getPortfolioSummary(chainId: number = 31337, bufferPct: number = 30.0) {
    return {
      success: true,
      chainId,
      bufferPct,
      newExposure: {
        availability: 'DISABLED',
        reason: 'New lending exposure is not offered in the portfolio-only release.',
        enforcement: { api: true, onchain: false },
      },
      authorityMode: 'UNRESTRICTED_OWNER',
      existingPositions: 'Use the basket positions endpoint; unavailable discovery is not zero debt.',
    };
  }
}
