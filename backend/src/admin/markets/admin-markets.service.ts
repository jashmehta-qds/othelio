import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RiskSplitService } from '../../risksplit/risksplit.service';
import { describeReviewedB20, reviewedB20FeedAdditions } from '../../config/reviewed-b20-feeds';
import {
  AdminMarketItem,
  AdminMarketPreviewRequest,
  AdminMarketPreviewResponse,
  AdminMarketsResponse,
  AdminTransactionPreview,
  PayoffScenario,
  settlementAdapterAbi,
  seriesFactoryAbi,
  TOKEN_FEED_REGISTRY,
} from '@othelio/shared';
import { createPublicClient, encodeAbiParameters, getAddress, http, isAddress, keccak256, parseAbiParameters } from 'viem';
import { rpcUrlForChain } from '../../config/network-runtime';
import { validateExpiryCalendar } from './calendar.util';
import { adminContracts, settlementAdapterForFeed } from '../admin-deployment';

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
export class AdminMarketsService {
  private readonly logger = new Logger(AdminMarketsService.name);

  constructor(
    @Optional() private readonly db?: DatabaseService,
    @Optional() private readonly riskSplitService?: RiskSplitService,
  ) {}

  async getMarkets(chainIdInput = 8453): Promise<AdminMarketsResponse> {
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

    const items: AdminMarketItem[] = [];

    if (this.db) {
      try {
        const res = await this.db.query(
          `SELECT * FROM risk_split_series WHERE chain_id = $1 ORDER BY expiry_timestamp DESC`,
          [chainId]
        );

        const nowSecs = Math.floor(Date.now() / 1000);

        for (const row of res.rows || []) {
          const underlyingAddr = (row.underlying_address || '').toLowerCase();
          const config = Object.values(TOKEN_FEED_REGISTRY).find(
            (c) => c.tokenAddress.toLowerCase() === underlyingAddr
          );

          const decimals = config?.tokenDecimals ?? 8;
          const symbol = config?.symbol ?? 'UNKNOWN';

          const floorPriceBig = BigInt(row.floor_price || '0');
          const capPriceBig = BigInt(row.cap_price || '0');
          const refPriceBig = row.creation_reference_price ? BigInt(row.creation_reference_price) : null;
          const settledPriceBig = row.settled_price ? BigInt(row.settled_price) : null;

          const expiryTs = Number(row.expiry_timestamp);
          const isExpired = nowSecs >= expiryTs;

          items.push({
            seriesAddress: row.series_address,
            underlying: {
              address: row.underlying_address,
              symbol,
              decimals,
            },
            floorPrice: floorPriceBig.toString(),
            capPrice: capPriceBig.toString(),
            floorFormatted: `$${(Number(floorPriceBig) / 1e8).toFixed(2)}`,
            capFormatted: `$${(Number(capPriceBig) / 1e8).toFixed(2)}`,
            expiryTimestamp: expiryTs,
            expiryIso: new Date(expiryTs * 1000).toISOString(),
            isExpired,
            referencePrice: refPriceBig ? refPriceBig.toString() : null,
            referenceRoundId: row.creation_reference_round_id ? row.creation_reference_round_id.toString() : null,
            referenceFeed: row.creation_reference_feed || null,
            referenceBlock: row.creation_reference_block ? Number(row.creation_reference_block) : null,
            isSettled: Boolean(row.is_settled),
            settledPrice: settledPriceBig ? settledPriceBig.toString() : null,
            settledRoundId: row.settled_round_id ? row.settled_round_id.toString() : null,
            settledFeedUpdatedAt: row.settled_feed_updated_at ? new Date(row.settled_feed_updated_at).toISOString() : null,
            protectedTokenAddress: row.protected_token_address || null,
            upsideTokenAddress: row.upside_token_address || null,
            collateralTotal: '0',
            openInterest: '0',
            operationsAuditStatus: row.operations_audit_status || 'NORMAL',
            operationsAuditNote: row.operations_audit_note || null,
            lastIndexedBlock: row.last_indexed_block ? Number(row.last_indexed_block) : 0,
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch markets from db: ${err}`);
      }
    }

    return {
      data: items,
      asOfBlock,
    };
  }

  async previewMarket(params: AdminMarketPreviewRequest): Promise<AdminMarketPreviewResponse> {
    const chainId = params.chainId ? Number(params.chainId) : 8453;
    if (typeof params.underlying !== 'string' || !isAddress(params.underlying)) {
      throw new BadRequestException('Select a valid underlying address.');
    }
    const underlyingNorm = params.underlying.toLowerCase();

    const { riskSplit: factoryAddress, assetRegistry } = adminContracts(chainId);
    if (!factoryAddress) {
      throw new BadRequestException('Risk Split factory is not deployed/configured. Set RISK_SPLIT_FACTORY_ADDRESS.');
    }
    if (params.factoryAddress && params.factoryAddress.toLowerCase() !== factoryAddress.toLowerCase()) {
      throw new BadRequestException('Requested factory does not match the configured deployment.');
    }

    // 1. Identify underlying asset and feed
    const rpcUrl = rpcUrlForChain(chainId);
    if (!rpcUrl) throw new BadRequestException(`No RPC configured for chain ${chainId}.`);
    const client = createPublicClient({ transport: http(rpcUrl) });
    const builtIn = Object.values(TOKEN_FEED_REGISTRY).find(
      (c) => c.tokenAddress.toLowerCase() === underlyingNorm
    );
    const reviewedFeed = builtIn ? undefined : reviewedB20FeedAdditions(chainId).get(underlyingNorm);
    const config = builtIn ?? (reviewedFeed
      ? await describeReviewedB20(chainId, getAddress(params.underlying), reviewedFeed, client, assetRegistry)
      : null);
    if (!config) {
      throw new BadRequestException(`Underlying asset ${params.underlying} has no reviewed, registry-enabled feed.`);
    }
    const settlementAdapter = settlementAdapterForFeed(config.feedAddress, 'RISK_SPLIT_SETTLEMENT_ADAPTERS_JSON',
      'RISK_SPLIT_SETTLEMENT_ADAPTER', 'RISK_SPLIT_SETTLEMENT_ADAPTER_ADDRESS');
    if (!settlementAdapter) {
      throw new BadRequestException('Risk Split settlement adapter is not configured for this asset.');
    }
    if (params.settlementAdapter && params.settlementAdapter.toLowerCase() !== settlementAdapter.toLowerCase()) {
      throw new BadRequestException('Requested adapter does not match the configured deployment.');
    }

    // 2. Calendar and publication window validation
    const calendarCheck = validateExpiryCalendar(params.expiryTimestamp);
    if (!calendarCheck.valid) {
      throw new BadRequestException(calendarCheck.error || 'Invalid expiry calendar specification.');
    }

    // 3. Fetch current live reference round from feed
    let refPriceBig: bigint;
    let refRoundIdStr: string;
    let refUpdatedAtIso: string;

    {
      try {
        const [factoryCode, adapterCode, adapterFeed, headBlock] = await Promise.all([
          client.getBytecode({ address: factoryAddress }),
          client.getBytecode({ address: settlementAdapter }),
          client.readContract({ address: settlementAdapter, abi: settlementAdapterAbi, functionName: 'priceFeed' }),
          client.getBlock({ blockTag: 'latest' }),
        ]);
        if (!factoryCode || factoryCode === '0x' || !adapterCode || adapterCode === '0x') {
          throw new Error('Factory or settlement adapter has no deployed bytecode');
        }
        if (adapterFeed.toLowerCase() !== config.feedAddress.toLowerCase()) {
          throw new BadRequestException(`Settlement adapter feed ${adapterFeed} does not match ${config.symbol} feed ${config.feedAddress}.`);
        }
        const roundData = await client.readContract({
          address: config.feedAddress,
          abi: AGGREGATOR_ABI,
          functionName: 'latestRoundData',
        });
        if (!roundData || roundData[1] <= 0n || roundData[3] === 0n) throw new Error('Feed has no valid positive round');
        const chainNow = Number(headBlock.timestamp);
        if (Number(roundData[3]) > chainNow || chainNow - Number(roundData[3]) > 86400) {
          throw new Error('Feed round is stale or in the future');
        }
        refRoundIdStr = roundData[0].toString();
        refPriceBig = BigInt(roundData[1]);
        refUpdatedAtIso = new Date(Number(roundData[3]) * 1000).toISOString();
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        this.logger.warn(`Failed to query feed ${config.feedAddress} onchain: ${err}`);
        throw new BadRequestException(`Factory, adapter, or live reference feed unavailable for ${config.symbol}; market preview cannot be signed.`);
      }
    }

    // 4. Compute / Validate Floor and Cap Prices
    let floorPriceBig: bigint;
    let capPriceBig: bigint;

    if (params.floorPercent !== undefined && params.capPercent !== undefined) {
      if (params.floorPercent <= 0 || params.capPercent <= params.floorPercent) {
        throw new BadRequestException('Floor percent must be positive and strictly less than cap percent.');
      }
      floorPriceBig = (refPriceBig * BigInt(Math.round(params.floorPercent * 100))) / 10000n;
      capPriceBig = (refPriceBig * BigInt(Math.round(params.capPercent * 100))) / 10000n;
    } else if (params.floorPrice && params.capPrice) {
      floorPriceBig = BigInt(params.floorPrice);
      capPriceBig = BigInt(params.capPrice);
    } else {
      throw new BadRequestException('Must supply either floorPercent/capPercent or floorPrice/capPrice.');
    }

    if (floorPriceBig <= 0n) {
      throw new BadRequestException('Floor price must be greater than zero.');
    }
    if (floorPriceBig >= capPriceBig) {
      throw new BadRequestException('Floor price must be strictly less than cap price.');
    }

    // 5. Duplicate terms check
    let duplicateTermsDetected = false;
    const termKey = keccak256(
      encodeAbiParameters(parseAbiParameters('address, uint256, uint256, uint256, address'), [
        config.tokenAddress,
        floorPriceBig,
        capPriceBig,
        BigInt(params.expiryTimestamp),
        settlementAdapter,
      ])
    );

    if (this.db) {
      try {
        const dupRes = await this.db.query(
          `SELECT 1 FROM risk_split_series
           WHERE chain_id = $1 AND LOWER(underlying_address) = $2
             AND floor_price = $3 AND cap_price = $4 AND expiry_timestamp = $5 LIMIT 1`,
          [chainId, config.tokenAddress.toLowerCase(), floorPriceBig.toString(), capPriceBig.toString(), params.expiryTimestamp]
        );
        if (dupRes.rows && dupRes.rows.length > 0) {
          duplicateTermsDetected = true;
        }
      } catch (err) {
        this.logger.warn(`Failed DB duplicate terms check: ${err}`);
      }
    }

    if (duplicateTermsDetected) {
      throw new BadRequestException('Duplicate series terms: a series with these exact terms already exists.');
    }

    // 6. Check if expiry is already approved on factory
    let expiryAlreadyApproved = false;
    if (rpcUrl) {
      try {
        const client = createPublicClient({ transport: http(rpcUrl) });
        const isApproved = await client.readContract({
          address: factoryAddress,
          abi: seriesFactoryAbi,
          functionName: 'approvedExpiry',
          args: [config.tokenAddress, BigInt(params.expiryTimestamp)],
        });
        expiryAlreadyApproved = Boolean(isApproved);
      } catch (err) {
        this.logger.warn(`Failed to check approvedExpiry onchain: ${err}`);
      }
    }

    // 7. Payoff simulation across 5 price regimes
    const WAD = 1000000000000000000n;
    const F = floorPriceBig;
    const C = capPriceBig;

    const calcPayoff = (S: bigint): { protectedPayout: bigint; upsidePayout: bigint; regime: string } => {
      if (S === 0n) {
        return { protectedPayout: 0n, upsidePayout: 0n, regime: 'Regime 1: Spot = 0' };
      }
      if (S < F) {
        return { protectedPayout: S, upsidePayout: 0n, regime: 'Regime 2: Full Downside Absorption (S < F)' };
      }
      if (S < 2n * F) {
        return { protectedPayout: F, upsidePayout: S - F, regime: 'Regime 3: Asymmetric Shield (F <= S < 2F)' };
      }
      if (S < 2n * C) {
        const split = S / 2n;
        return { protectedPayout: split, upsidePayout: split, regime: 'Regime 4: 50/50 Symmetric (2F <= S < 2C)' };
      }
      return { protectedPayout: C, upsidePayout: S - C, regime: 'Regime 5: Upside Participation (S >= 2C)' };
    };

    const testPrices = [
      { ratio: 0.0, price: 0n },
      { ratio: 0.5, price: F / 2n },
      { ratio: 1.2, price: (F * 12n) / 10n },
      { ratio: 1.5, price: F + C },
      { ratio: 2.2, price: (C * 22n) / 10n },
    ];

    const payoffScenarios: PayoffScenario[] = testPrices.map((tp) => {
      const p = calcPayoff(tp.price);
      return {
        spotPrice: tp.price.toString(),
        spotRatio: tp.ratio,
        protectedPayout: p.protectedPayout.toString(),
        upsidePayout: p.upsidePayout.toString(),
        regime: p.regime,
      };
    });

    // 8. Signable Transactions Preview
    const transactions: AdminTransactionPreview[] = [];

    if (!expiryAlreadyApproved) {
      transactions.push({
        description: `Approve Expiry Timestamp on SeriesFactory for ${config.symbol}`,
        target: factoryAddress,
        chainId,
        method: 'setApprovedExpiry',
        args: [config.tokenAddress, params.expiryTimestamp, true],
        expectedState: `approvedExpiry[${config.symbol}][${params.expiryTimestamp}] == true`,
        simulationResult: {
          success: true,
          message: 'Valid owner transaction prepared to authorize exact expiry schedule.',
        },
      });
    }

    transactions.push({
      description: `Create Risk Split Series for ${config.symbol}`,
      target: factoryAddress,
      chainId,
      method: 'createSeries',
      args: [
        config.tokenAddress,
        floorPriceBig.toString(),
        capPriceBig.toString(),
        params.expiryTimestamp,
        settlementAdapter,
      ],
      expectedState: 'New RiskSplitSeries deployed with initialized ClaimTokens',
      simulationResult: {
        success: true,
        message: 'Series parameters validated against live feed reference and calendar.',
      },
    });

    return {
      underlying: {
        address: config.tokenAddress,
        symbol: config.symbol,
        decimals: config.tokenDecimals,
      },
      referenceObservation: {
        roundId: refRoundIdStr,
        price: refPriceBig.toString(),
        formattedPrice: `$${(Number(refPriceBig) / 1e8).toFixed(2)}`,
        updatedAt: refUpdatedAtIso,
      },
      floorPrice: floorPriceBig.toString(),
      capPrice: capPriceBig.toString(),
      floorFormatted: `$${(Number(floorPriceBig) / 1e8).toFixed(2)}`,
      capFormatted: `$${(Number(capPriceBig) / 1e8).toFixed(2)}`,
      expiryTimestamp: params.expiryTimestamp,
      expiryIso: new Date(params.expiryTimestamp * 1000).toISOString(),
      calendarCheck,
      expiryAlreadyApproved,
      duplicateTermsDetected: false,
      payoffScenarios,
      transactions,
    };
  }
}
