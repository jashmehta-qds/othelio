import { BadRequestException, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  AdminAssetItem,
  AdminAssetsResponse,
  AdminTransactionPreview,
  assetRegistryAbi,
  BASE_MAINNET_CHAIN_ID,
  TOKEN_FEED_REGISTRY,
} from '@othelio/shared';
import { createPublicClient, getAddress, http, isAddress, parseAbi, zeroAddress } from 'viem';
import { rpcUrlForChain } from '../../config/network-runtime';
import { RiskSplitService } from '../../risksplit/risksplit.service';
import { hasApprovedBasketRoute, resolveBasketRouteRegistry } from '../../dex/basket-route-readiness';
import { CoinbaseTokenMetadataService } from '../../baskets/coinbase-token-metadata.service';
import { reviewedB20Additions, reviewedB20FeedAdditions } from '../../config/reviewed-b20-feeds';
import { adminTokenAbi, readAdminFeed } from '../admin-oracle';
import { adminContracts } from '../admin-deployment';

const b20Factory = '0xb20f000000000000000000000000000000000000';
const b20FactoryAbi = parseAbi([
  'function isB20(address token) view returns (bool)',
  'function isB20Initialized(address token) view returns (bool)',
]);

const AGGREGATOR_ABI = [
  {
    type: 'function',
    name: 'latestRoundData',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
] as const;

@Injectable()
export class AdminAssetsService {
  private readonly logger = new Logger(AdminAssetsService.name);
  private readonly coinbase = new CoinbaseTokenMetadataService();

  constructor(
    @Optional() private readonly db?: DatabaseService,
    @Optional() private readonly riskSplitService?: RiskSplitService,
  ) {}

  getRegistryAddress(chainId: number): `0x${string}` {
    const address = adminContracts(chainId).assetRegistry;
    if (address) return address;
    throw new BadRequestException(`Asset registry is not configured for chain ${chainId}. Set ASSET_REGISTRY_ADDRESS.`);
  }

  async getAssets(chainIdInput = 8453): Promise<AdminAssetsResponse> {
    const chainId = Number(chainIdInput);

    let asOfBlock = 0;
    if (this.riskSplitService) {
      try {
        const freshness = await this.riskSplitService.getIndexerFreshness(chainId);
        asOfBlock = freshness.lastIndexedBlock;
      } catch {
        asOfBlock = 0;
      }
    }

    // Query DB price observations if available
    const dbObservations = new Map<string, { priceUsdE8: string; updatedAt: string; roundId?: string; isFresh: boolean }>();
    if (this.db) {
      try {
        const query = `
          SELECT DISTINCT ON (LOWER(asset_address))
            LOWER(asset_address) AS asset_address,
            price_usd_e8::text,
            feed_round_id::text,
            observed_at,
            (observed_at >= NOW() - INTERVAL '300 seconds') AS is_fresh
          FROM asset_price_observations
          WHERE chain_id = $1
          ORDER BY LOWER(asset_address), block_number DESC;
        `;
        const res = await this.db.query(query, [chainId]);
        for (const row of res.rows || []) {
          dbObservations.set(row.asset_address, {
            priceUsdE8: row.price_usd_e8,
            updatedAt: row.observed_at ? new Date(row.observed_at).toISOString() : new Date().toISOString(),
            roundId: row.feed_round_id || null,
            isFresh: Boolean(row.is_fresh),
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch db price observations: ${err}`);
      }
    }

    const rpcUrl = rpcUrlForChain(chainId);
    const client = rpcUrl ? createPublicClient({ transport: http(rpcUrl) }) : null;
    const registryAddress = adminContracts(chainId).assetRegistry;
    const routeRegistryAddress = client ? await resolveBasketRouteRegistry(client) : null;
    const additions = reviewedB20FeedAdditions(chainId).size
      ? reviewedB20Additions(chainId, await this.coinbase.getAll()) : [];
    const candidates = [...Object.values(TOKEN_FEED_REGISTRY), ...additions];

    const assetItems: AdminAssetItem[] = await Promise.all(candidates.map(async (config) => {
      const normAddr = config.tokenAddress.toLowerCase();
      const dbObs = dbObservations.get(normAddr);

      let priceUsdE8 = dbObs?.priceUsdE8 ?? null;
      let roundId = dbObs?.roundId ?? null;
      let updatedAt = dbObs?.updatedAt ?? null;
      let isFresh = dbObs?.isFresh ?? false;

      // If no DB obs, try reading latestRoundData onchain via client
      if (!priceUsdE8 && client && config.feedAddress) {
        try {
          const roundData = await client.readContract({
            address: config.feedAddress,
            abi: AGGREGATOR_ABI,
            functionName: 'latestRoundData',
          });
          if (roundData && roundData[1] > 0n) {
            priceUsdE8 = roundData[1].toString();
            roundId = roundData[0].toString();
            const updatedSecs = Number(roundData[3]);
            updatedAt = new Date(updatedSecs * 1000).toISOString();
            const nowSecs = Math.floor(Date.now() / 1000);
            isFresh = nowSecs - updatedSecs <= 86400; // within 24h
          }
        } catch {
          // Feed query fail handled gracefully
        }
      }

      // Check registry status
      let isSupportedInRegistry = false;
      if (client && registryAddress) {
        try {
          const res = await client.readContract({
            address: registryAddress,
            abi: assetRegistryAbi,
            functionName: 'getAsset',
            args: [BigInt(chainId), config.tokenAddress],
          });
          isSupportedInRegistry = res.supported && res.isCoinbaseB20 &&
            res.priceFeed.toLowerCase() === config.feedAddress.toLowerCase() &&
            res.tokenDecimals === config.tokenDecimals && res.feedDecimals === config.feedDecimals;
        } catch {
          isSupportedInRegistry = false;
        }
      }

      const hasRoute = Boolean(client && routeRegistryAddress &&
        await hasApprovedBasketRoute(client, routeRegistryAddress, chainId, config.tokenAddress));

      const isB20 = true;
      const tradeable = isSupportedInRegistry && hasRoute && priceUsdE8 !== null && isFresh;
      const staged = !tradeable;

      return {
        address: config.tokenAddress,
        symbol: config.symbol,
        name: config.name,
        decimals: config.tokenDecimals,
        isCoinbaseB20: isB20,
        totalSupply: null,
        priceFeed: {
          address: config.feedAddress,
          decimals: config.feedDecimals,
          priceUsdE8,
          roundId,
          updatedAt,
          isFresh,
        },
        registryStatus: {
          isSupported: isSupportedInRegistry,
          isB20,
        },
        routeStatus: {
          hasRoute,
        },
        staged,
        tradeable,
      } satisfies AdminAssetItem;
    }));

    return {
      data: assetItems,
      asOfBlock,
    };
  }

  async previewEnableAsset(assetAddress: string, chainIdInput = 8453): Promise<AdminTransactionPreview[]> {
    const chainId = Number(chainIdInput);
    if (typeof assetAddress !== 'string' || !isAddress(assetAddress) || assetAddress.toLowerCase() === zeroAddress) {
      throw new BadRequestException('Enter a valid B20 token address.');
    }
    const norm = assetAddress.toLowerCase();
    const reviewed = Object.values(TOKEN_FEED_REGISTRY).find((c) => c.tokenAddress.toLowerCase() === norm);
    const additions = reviewedB20FeedAdditions(chainId);
    const config = reviewed ?? (additions.has(norm)
      ? reviewedB20Additions(chainId, await this.coinbase.getAll()).find((asset) => asset.tokenAddress.toLowerCase() === norm)
      : undefined);
    if (!config) throw new BadRequestException('This token needs a reviewed B20 feed and a matching Coinbase catalog entry before enablement.');

    const registryAddress = this.getRegistryAddress(chainId);

    const rpcUrl = rpcUrlForChain(chainId);
    if (!rpcUrl) throw new ServiceUnavailableException(`No RPC configured for chain ${chainId}.`);
    const client = createPublicClient({ transport: http(rpcUrl) });
    try {
      const block = await client.getBlock();
      const blockNumber = block.number;
      if (blockNumber === null) throw new Error('No confirmed block');
      const query = { address: config.tokenAddress, abi: adminTokenAbi, blockNumber };
      const [decimals, supply, feed, current] = await Promise.all([
        client.readContract({ ...query, functionName: 'decimals' }),
        client.readContract({ ...query, functionName: 'totalSupply' }),
        readAdminFeed(client, config.feedAddress, { number: blockNumber, timestamp: block.timestamp }),
        client.readContract({
          address: registryAddress, abi: assetRegistryAbi, functionName: 'getAsset',
          args: [BigInt(chainId), config.tokenAddress], blockNumber,
        }),
      ]);
      if (current.supported) throw new BadRequestException('This token is already enabled; onboarding will not overwrite an active feed.');
      if (decimals !== config.tokenDecimals || decimals > 18 || supply <= 0n || feed.decimals !== config.feedDecimals) {
        throw new BadRequestException('Token supply or configured decimals could not be verified.');
      }
      if (chainId === BASE_MAINNET_CHAIN_ID) {
        const identity = { address: b20Factory, abi: b20FactoryAbi, args: [config.tokenAddress], blockNumber } as const;
        const [b20, initialized] = await Promise.all([
          client.readContract({ ...identity, functionName: 'isB20' }),
          client.readContract({ ...identity, functionName: 'isB20Initialized' }),
        ]);
        if (!b20 || !initialized) throw new BadRequestException('Token is not an initialized Base B20.');
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException('Could not verify the token, registry, and live feed at a confirmed block.');
    }

    const previews: AdminTransactionPreview[] = [
      {
        description: `Configure ${config.symbol} in OthelioAssetRegistry`,
        target: registryAddress,
        chainId,
        method: 'configure',
        args: [chainId, config.tokenAddress, config.feedAddress, true, config.tokenDecimals, config.feedDecimals, true],
        expectedState: 'Token registered in OthelioAssetRegistry with 8-decimal Chainlink feed',
      },
    ];

    return previews;
  }
}
