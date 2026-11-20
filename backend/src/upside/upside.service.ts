import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  ContinuousPayoffCalculation,
  UpsideAssetItem,
  UpsideAssetsResponse,
  UpsideMarketModel,
  UpsidePositionModel,
  UpsideRoundModel,
  UpsideStockHistoryPoint,
  UpsideStockHistoryResponse,
} from './upside.types';
import {
  BASE_MAINNET_REGISTRY,
  TOKEN_FEED_REGISTRY,
} from '@othelio/shared';
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
} from 'viem';
import { rpcUrlForChain } from '../config/network-runtime';

export const WAD = 1000000000000000000n; // 1e18

const REGISTRY_ABI = parseAbi([
  'function isSupported(uint256 chainId, address token) view returns (bool)',
  'function getAsset(uint256 chainId, address token) view returns ((bool supported, address priceFeed, uint8 tokenDecimals, uint8 feedDecimals, bool isCoinbaseB20))',
  'function getSupportedTokens(uint256 chainId) view returns (address[])',
]);

const ERC20_METADATA_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
]);

@Injectable()
export class UpsideService {
  private readonly logger = new Logger(UpsideService.name);

  // In-memory mock storage for local dev / testing
  private mockRounds: Map<string, UpsideRoundModel> = new Map();
  private mockMarkets: Map<string, UpsideMarketModel> = new Map();
  private mockPositions: Map<string, UpsidePositionModel> = new Map();

  constructor(@Optional() private readonly db?: DatabaseService) {}

  getRegistryAddress(chainId: number): `0x${string}` {
    const envAddr = (process.env.ASSET_REGISTRY_ADDRESS || process.env.OTHELIO_ASSET_REGISTRY)?.trim();
    if (envAddr && isAddress(envAddr) && !/^0x0{40}$/i.test(envAddr)) {
      return getAddress(envAddr);
    }
    return getAddress(BASE_MAINNET_REGISTRY);
  }

  private createClient(chainId: number) {
    const rpcUrl = rpcUrlForChain(chainId);
    if (!rpcUrl) return null;
    return createPublicClient({ transport: http(rpcUrl) });
  }

  /**
   * Continuous payoff calculation:
   * U(S) = max(S - K, 0)
   * R(S) = min(S, K)
   * Fractions: U(S) * 1e18 / S and R(S) * 1e18 / S
   */
  calculatePayoff(strikePrice: bigint, spotPrice: bigint): ContinuousPayoffCalculation {
    const K = strikePrice;
    const S = spotPrice;

    if (S <= 0n) {
      return {
        strikePrice: K,
        spotPrice: S,
        upsideValue: 0n,
        residualValue: 0n,
        upsideFractionWad: 0n,
        residualFractionWad: WAD,
      };
    }

    const upsideValue = S > K ? S - K : 0n;
    const residualValue = S > K ? K : S;

    const upsideFractionWad = (upsideValue * WAD) / S;
    const residualFractionWad = WAD - upsideFractionWad;

    return {
      strikePrice: K,
      spotPrice: S,
      upsideValue,
      residualValue,
      upsideFractionWad,
      residualFractionWad,
    };
  }

  /**
   * Enumerate supported tokens from onchain OthelioAssetRegistry.
   * Mirrors onchain registry dynamically even for tokens absent from TOKEN_FEED_REGISTRY.
   */
  async getAssets(chainIdInput = 8453): Promise<UpsideAssetsResponse> {
    const chainId = Number(chainIdInput);
    const registryAddress = this.getRegistryAddress(chainId);
    const client = this.createClient(chainId);

    let supportedTokens: `0x${string}`[] = [];

    if (client) {
      try {
        const tokens = await client.readContract({
          address: registryAddress,
          abi: REGISTRY_ABI,
          functionName: 'getSupportedTokens',
          args: [BigInt(chainId)],
        });
        supportedTokens = tokens.map((t) => getAddress(t));
      } catch (err) {
        this.logger.warn(`Failed to call getSupportedTokens on registry: ${err}. Falling back to catalog.`);
      }
    }

    // If client failed or returned empty in test, fallback to TOKEN_FEED_REGISTRY
    if (supportedTokens.length === 0) {
      supportedTokens = Object.keys(TOKEN_FEED_REGISTRY).map((addr) => getAddress(addr));
    }

    // Query DB price observations
    const dbObservations = new Map<string, { priceUsdE8: string; updatedAt: string; isFresh: boolean }>();
    if (this.db) {
      try {
        const res = await this.db.query(
          `SELECT DISTINCT ON (LOWER(asset_address))
             LOWER(asset_address) as asset_address,
             price_usd_e8::text,
             observed_at,
             (observed_at >= NOW() - INTERVAL '3600 seconds') as is_fresh
           FROM asset_price_observations
           WHERE chain_id = $1
           ORDER BY LOWER(asset_address), block_number DESC`,
          [chainId],
        );
        for (const row of res.rows || []) {
          dbObservations.set(row.asset_address, {
            priceUsdE8: row.price_usd_e8,
            updatedAt: row.observed_at ? new Date(row.observed_at).toISOString() : new Date().toISOString(),
            isFresh: Boolean(row.is_fresh),
          });
        }
      } catch (err) {
        this.logger.warn(`DB observation query failed: ${err}`);
      }
    }

    const assets: UpsideAssetItem[] = await Promise.all(
      supportedTokens.map(async (tokenAddr) => {
        const normAddr = tokenAddr.toLowerCase();
        const catalogEntry = Object.values(TOKEN_FEED_REGISTRY).find(
          (c) => c.tokenAddress.toLowerCase() === normAddr,
        );

        let symbol = catalogEntry?.symbol || 'UNKNOWN';
        let name = catalogEntry?.name || 'Unknown Token';
        let decimals = catalogEntry?.tokenDecimals || 8;
        let feedAddress = catalogEntry?.feedAddress || '0x0000000000000000000000000000000000000000';
        let feedDecimals = catalogEntry?.feedDecimals || 8;
        let isSupportedInRegistry = true;
        let isEligible = true;
        let ineligibilityReason: string | undefined;

        if (client) {
          try {
            const assetInfo = await client.readContract({
              address: registryAddress,
              abi: REGISTRY_ABI,
              functionName: 'getAsset',
              args: [BigInt(chainId), tokenAddr],
            });
            isSupportedInRegistry = assetInfo.supported;
            if (assetInfo.priceFeed && assetInfo.priceFeed !== '0x0000000000000000000000000000000000000000') {
              feedAddress = assetInfo.priceFeed;
              feedDecimals = assetInfo.feedDecimals;
              decimals = assetInfo.tokenDecimals;
            }
          } catch {
            // keep catalog fallback
          }

          if (symbol === 'UNKNOWN') {
            try {
              const sym = await client.readContract({
                address: tokenAddr,
                abi: ERC20_METADATA_ABI,
                functionName: 'symbol',
              });
              symbol = sym;
            } catch {}
          }
        }

        if (!isSupportedInRegistry) {
          isEligible = false;
          ineligibilityReason = 'NOT_SUPPORTED_IN_ASSET_REGISTRY';
        } else if (!feedAddress || feedAddress === '0x0000000000000000000000000000000000000000') {
          isEligible = false;
          ineligibilityReason = 'NO_VALID_PRICE_FEED';
        }

        const obs = dbObservations.get(normAddr);
        const currentPriceUsd = obs ? formatUnits(BigInt(obs.priceUsdE8), 8) : undefined;

        return {
          tokenAddress: tokenAddr,
          symbol,
          name,
          decimals,
          feedAddress,
          feedDecimals,
          isSupportedInRegistry,
          isEligibleForUpside: isEligible,
          ineligibilityReason,
          currentPriceUsd,
          priceUpdatedAt: obs?.updatedAt,
          isFreshPrice: obs?.isFresh,
        };
      }),
    );

    let asOfBlock = 0;
    if (this.db) {
      try {
        const row = await this.db.query(
          "SELECT last_success_block FROM indexer_worker_state WHERE chain_id = $1 AND worker_name = 'events'",
          [chainId],
        );
        asOfBlock = Number(row?.rows?.[0]?.last_success_block || 0);
      } catch {}
    }

    return {
      chainId,
      registryAddress,
      asOfBlock,
      assets,
    };
  }

  async getRounds(chainIdInput = 8453, underlying?: string): Promise<UpsideRoundModel[]> {
    const chainId = Number(chainIdInput);

    if (this.db) {
      try {
        let query = `
          SELECT r.*, COUNT(m.series_address)::int as markets_count
          FROM upside_rounds r
          LEFT JOIN upside_markets m ON r.chain_id = m.chain_id AND r.round_id = m.round_id
          WHERE r.chain_id = $1
        `;
        const params: any[] = [chainId];

        if (underlying) {
          params.push(underlying.toLowerCase());
          query += ` AND LOWER(r.underlying_address) = $${params.length}`;
        }

        query += ` GROUP BY r.chain_id, r.round_id ORDER BY r.expiry_timestamp DESC`;

        const res = await this.db.query(query, params);
        if (res?.rows && res.rows.length > 0) {
          return res.rows.map((row: any) => ({
            chainId,
            roundId: Number(row.round_id),
            factoryAddress: row.factory_address.trim(),
            underlyingAddress: row.underlying_address.trim(),
            feedAddress: row.feed_address.trim(),
            adapterAddress: row.adapter_address.trim(),
            referenceRoundId: row.reference_round_id ? row.reference_round_id.toString() : '0',
            referencePrice: row.reference_price ? row.reference_price.toString() : '0',
            referencePriceFormatted: row.reference_price ? formatUnits(BigInt(row.reference_price), 8) : '0.00',
            referenceTime: Number(row.reference_time),
            roundStart: Number(row.round_start),
            expiryTimestamp: Number(row.expiry_timestamp),
            expectedMove: row.expected_move ? row.expected_move.toString() : '0',
            expectedMoveFormatted: row.expected_move ? formatUnits(BigInt(row.expected_move), 8) : '0.00',
            provenanceHash: row.provenance_hash.trim(),
            strikeTick: row.strike_tick ? row.strike_tick.toString() : '0',
            minStrike: row.min_strike ? row.min_strike.toString() : '0',
            maxStrike: row.max_strike ? row.max_strike.toString() : '0',
            createdBlock: Number(row.created_block),
            createdTx: row.created_tx.trim(),
            createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
            marketsCount: Number(row.markets_count || 0),
          }));
        }
      } catch (err) {
        this.logger.warn(`Failed DB query for upside rounds: ${err}. Falling back to memory.`);
      }
    }

    return Array.from(this.mockRounds.values()).filter(
      (r) => r.chainId === chainId && (!underlying || r.underlyingAddress.toLowerCase() === underlying.toLowerCase()),
    );
  }

  async getMarkets(chainIdInput = 8453, roundId?: number, underlying?: string): Promise<UpsideMarketModel[]> {
    const chainId = Number(chainIdInput);

    if (this.db) {
      try {
        let query = `SELECT * FROM upside_markets WHERE chain_id = $1`;
        const params: any[] = [chainId];

        if (roundId !== undefined) {
          params.push(roundId);
          query += ` AND round_id = $${params.length}`;
        }
        if (underlying) {
          params.push(underlying.toLowerCase());
          query += ` AND LOWER(underlying_address) = $${params.length}`;
        }

        query += ` ORDER BY expiry_timestamp DESC, strike_price ASC`;

        const res = await this.db.query(query, params);
        if (res?.rows && res.rows.length > 0) {
          const markets = res.rows.map((row: any) => this.mapMarketRow(row, chainId));
          return this.enrichMarketLabels(markets);
        }
      } catch (err) {
        this.logger.warn(`Failed DB query for upside markets: ${err}. Falling back to memory.`);
      }
    }

    const filtered = Array.from(this.mockMarkets.values()).filter(
      (m) =>
        m.chainId === chainId &&
        (roundId === undefined || m.roundId === roundId) &&
        (!underlying || m.underlyingAddress.toLowerCase() === underlying.toLowerCase()),
    );
    return this.enrichMarketLabels(filtered);
  }

  async getMarket(chainIdInput = 8453, seriesAddress: string): Promise<UpsideMarketModel | null> {
    const chainId = Number(chainIdInput);
    const norm = seriesAddress.toLowerCase();

    if (this.db) {
      try {
        const res = await this.db.query(
          `SELECT * FROM upside_markets WHERE chain_id = $1 AND LOWER(series_address) = $2`,
          [chainId, norm],
        );
        if (res?.rows && res.rows.length > 0) {
          return this.mapMarketRow(res.rows[0], chainId);
        }
      } catch (err) {
        this.logger.warn(`Failed DB query for market ${seriesAddress}: ${err}`);
      }
    }

    return this.mockMarkets.get(`${chainId}:${norm}`) || null;
  }

  async getUserPositions(chainIdInput = 8453, userAddress: string): Promise<UpsidePositionModel[]> {
    const chainId = Number(chainIdInput);
    const normUser = userAddress.toLowerCase();

    if (this.db) {
      try {
        const query = `
          SELECT p.*, m.strike_price, m.expiry_timestamp, m.is_settled, m.underlying_address
          FROM upside_positions p
          JOIN upside_markets m ON p.chain_id = m.chain_id AND LOWER(p.series_address) = LOWER(m.series_address)
          WHERE p.chain_id = $1 AND LOWER(p.user_address) = $2
            AND (p.upside_balance > 0 OR p.residual_balance > 0 OR p.total_minted > 0)
          ORDER BY m.expiry_timestamp DESC
        `;
        const res = await this.db.query(query, [chainId, normUser]);
        if (res?.rows) {
          return res.rows.map((row: any) => ({
            chainId,
            seriesAddress: row.series_address.trim(),
            userAddress: row.user_address.trim(),
            upsideBalance: row.upside_balance ? row.upside_balance.toString() : '0',
            residualBalance: row.residual_balance ? row.residual_balance.toString() : '0',
            totalMinted: row.total_minted ? row.total_minted.toString() : '0',
            totalPairWithdrawn: row.total_pair_withdrawn ? row.total_pair_withdrawn.toString() : '0',
            totalUpsideRedeemed: row.total_upside_redeemed ? row.total_upside_redeemed.toString() : '0',
            totalResidualRedeemed: row.total_residual_redeemed ? row.total_residual_redeemed.toString() : '0',
            costBasisUsdc: row.cost_basis_usdc ? row.cost_basis_usdc.toString() : null,
            updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
            strikePrice: row.strike_price ? row.strike_price.toString() : undefined,
            expiryTimestamp: Number(row.expiry_timestamp || 0),
            isSettled: Boolean(row.is_settled),
          }));
        }
      } catch (err) {
        this.logger.warn(`Failed DB query for user positions: ${err}`);
      }
    }

    return Array.from(this.mockPositions.values()).filter(
      (p) => p.chainId === chainId && p.userAddress.toLowerCase() === normUser,
    );
  }

  async getStockHistory(chainIdInput = 8453, assetAddress: string): Promise<UpsideStockHistoryResponse> {
    const chainId = Number(chainIdInput);
    const norm = assetAddress.toLowerCase();

    const catalogEntry = Object.values(TOKEN_FEED_REGISTRY).find(
      (c) => c.tokenAddress.toLowerCase() === norm,
    );
    const symbol = catalogEntry?.symbol || 'STOCK';

    const history: UpsideStockHistoryPoint[] = [];

    if (this.db) {
      try {
        const query = `
          SELECT observed_at, price_usd_e8, block_number
          FROM asset_price_observations
          WHERE chain_id = $1 AND LOWER(asset_address) = $2
          ORDER BY observed_at ASC
          LIMIT 500
        `;
        const res = await this.db.query(query, [chainId, norm]);
        for (const row of res.rows || []) {
          const price = Number(formatUnits(BigInt(row.price_usd_e8), 8));
          const timestamp = Math.floor(new Date(row.observed_at).getTime() / 1000);
          history.push({
            timestamp,
            priceUsd: price,
            blockNumber: Number(row.block_number || 0),
            source: 'db_observation',
          });
        }
      } catch (err) {
        this.logger.warn(`Failed DB query for stock history: ${err}`);
      }
    }

    return {
      assetAddress,
      symbol,
      history,
      asOf: new Date().toISOString(),
      hasGaps: false,
    };
  }

  // Helper mocks for tests
  setMockRound(round: UpsideRoundModel) {
    this.mockRounds.set(`${round.chainId}:${round.roundId}`, round);
  }

  setMockMarket(market: UpsideMarketModel) {
    this.mockMarkets.set(`${market.chainId}:${market.seriesAddress.toLowerCase()}`, market);
  }

  setMockPosition(pos: UpsidePositionModel) {
    this.mockPositions.set(`${pos.chainId}:${pos.seriesAddress.toLowerCase()}:${pos.userAddress.toLowerCase()}`, pos);
  }

  clearMockData() {
    this.mockRounds.clear();
    this.mockMarkets.clear();
    this.mockPositions.clear();
  }

  private mapMarketRow(row: any, chainId: number): UpsideMarketModel {
    return {
      chainId,
      seriesAddress: row.series_address.trim(),
      roundId: Number(row.round_id),
      factoryAddress: row.factory_address.trim(),
      underlyingAddress: row.underlying_address.trim(),
      upsideTokenAddress: row.upside_token_address ? row.upside_token_address.trim() : '',
      residualTokenAddress: row.residual_token_address ? row.residual_token_address.trim() : '',
      strikePrice: row.strike_price ? row.strike_price.toString() : '0',
      strikePriceFormatted: row.strike_price ? formatUnits(BigInt(row.strike_price), 8) : '0.00',
      expiryTimestamp: Number(row.expiry_timestamp),
      isSettled: Boolean(row.is_settled),
      settledPrice: row.settled_price ? row.settled_price.toString() : null,
      settledPriceFormatted: row.settled_price ? formatUnits(BigInt(row.settled_price), 8) : null,
      settledRoundId: row.settled_round_id ? row.settled_round_id.toString() : null,
      settledTimestamp: row.settled_timestamp ? Number(row.settled_timestamp) : null,
      collateralSnapshot: row.collateral_snapshot ? row.collateral_snapshot.toString() : null,
      totalClaimSupplySnapshot: row.total_claim_supply_snapshot ? row.total_claim_supply_snapshot.toString() : null,
      upsideAllocation: row.upside_allocation ? row.upside_allocation.toString() : null,
      residualAllocation: row.residual_allocation ? row.residual_allocation.toString() : null,
      creatorAddress: row.creator_address ? row.creator_address.trim() : '',
      createdBlock: Number(row.created_block || 0),
      createdTx: row.created_tx ? row.created_tx.trim() : '',
      settledAt: row.settled_at ? new Date(row.settled_at).toISOString() : null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    };
  }

  private enrichMarketLabels(markets: UpsideMarketModel[]): UpsideMarketModel[] {
    const labels = ['Starting price', 'Reach', 'Strong move', 'Long shot'];
    // Group by roundId and sort by strike
    const byRound = new Map<number, UpsideMarketModel[]>();
    for (const m of markets) {
      const list = byRound.get(m.roundId) || [];
      list.push(m);
      byRound.set(m.roundId, list);
    }

    for (const list of byRound.values()) {
      list.sort((a, b) => (BigInt(a.strikePrice) < BigInt(b.strikePrice) ? -1 : 1));
      list.forEach((m, idx) => {
        m.targetLabel = labels[idx] || `Strike ${idx + 1}`;
      });
    }

    return markets;
  }
}
