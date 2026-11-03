import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  AdminAssetItem,
  AdminAssetsResponse,
  AdminTransactionPreview,
  BASE_LAUNCH_B20_TOKENS,
  TOKEN_FEED_REGISTRY,
} from '@othelio/shared';
import { createPublicClient, getAddress, http, isAddress } from 'viem';
import { rpcUrlForChain } from '../../config/network-runtime';
import { RiskSplitService } from '../../risksplit/risksplit.service';

const REGISTRY_VIEW_ABI = [
  {
    type: 'function',
    name: 'isSupported',
    inputs: [{ name: 'chainId', type: 'uint256' }, { name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

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

  constructor(
    @Optional() private readonly db?: DatabaseService,
    @Optional() private readonly riskSplitService?: RiskSplitService,
  ) {}

  getRegistryAddress(chainId: number): `0x${string}` {
    const envAddr = process.env.OTHELIO_ASSET_REGISTRY?.trim();
    if (envAddr && isAddress(envAddr)) {
      return getAddress(envAddr);
    }
    return '0x2222222222222222222222222222222222222222';
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
            round_id::text,
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
            roundId: row.round_id || null,
            isFresh: Boolean(row.is_fresh),
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch db price observations: ${err}`);
      }
    }

    const rpcUrl = rpcUrlForChain(chainId);
    const client = rpcUrl ? createPublicClient({ transport: http(rpcUrl) }) : null;
    const registryAddress = this.getRegistryAddress(chainId);

    const assetItems: AdminAssetItem[] = [];

    for (const [tokenAddr, config] of Object.entries(TOKEN_FEED_REGISTRY)) {
      const normAddr = tokenAddr.toLowerCase();
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
      if (client && registryAddress !== '0x2222222222222222222222222222222222222222') {
        try {
          const res = await client.readContract({
            address: registryAddress,
            abi: REGISTRY_VIEW_ABI,
            functionName: 'isSupported',
            args: [BigInt(chainId), config.tokenAddress],
          });
          isSupportedInRegistry = Boolean(res);
        } catch {
          isSupportedInRegistry = false;
        }
      } else {
        // Fallback: check if in BASE_LAUNCH_B20_TOKENS
        isSupportedInRegistry = (BASE_LAUNCH_B20_TOKENS as readonly string[])
          .map((t) => t.toLowerCase())
          .includes(normAddr);
      }

      const hasRoute = (BASE_LAUNCH_B20_TOKENS as readonly string[])
        .map((t) => t.toLowerCase())
        .includes(normAddr);

      const isB20 = true;
      const tradeable = isSupportedInRegistry && hasRoute && priceUsdE8 !== null;
      const staged = !tradeable;

      assetItems.push({
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
      });
    }

    return {
      data: assetItems,
      asOfBlock,
    };
  }

  async previewEnableAsset(assetAddress: string, chainIdInput = 8453): Promise<AdminTransactionPreview[]> {
    const chainId = Number(chainIdInput);
    const norm = assetAddress.toLowerCase();
    const config = Object.values(TOKEN_FEED_REGISTRY).find((c) => c.tokenAddress.toLowerCase() === norm);

    if (!config) {
      throw new BadRequestException(`Asset ${assetAddress} is not in the reviewed B20 token catalog.`);
    }

    const registryAddress = this.getRegistryAddress(chainId);

    const previews: AdminTransactionPreview[] = [
      {
        description: `Add ${config.symbol} to OthelioAssetRegistry`,
        target: registryAddress,
        chainId,
        method: 'addAsset',
        args: [config.tokenAddress, config.feedAddress, config.tokenDecimals, config.feedDecimals, true],
        expectedState: 'Token registered in OthelioAssetRegistry with 8-decimal Chainlink feed',
        simulationResult: {
          success: true,
          message: 'Registry call prepared for wallet signature by registry owner',
        },
      },
    ];

    return previews;
  }
}
