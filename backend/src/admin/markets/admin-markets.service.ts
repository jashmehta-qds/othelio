import { BadRequestException, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RiskSplitService } from '../../risksplit/risksplit.service';
import { describeReviewedB20, reviewedB20FeedAdditions } from '../../config/reviewed-b20-feeds';
import {
  AdminMarketItem,
  AdminMarketPreviewRequest,
  AdminMarketPreviewResponse,
  AdminMarketsResponse,
  AdminTransactionPreview,
  AdminRiskSplitSetupRequest,
  AdminRiskSplitSetupResponse,
  assetRegistryAbi,
  PayoffScenario,
  settlementAdapterAbi,
  seriesFactoryAbi,
  TOKEN_FEED_REGISTRY,
} from '@othelio/shared';
import { createPublicClient, encodeAbiParameters, getAddress, http, isAddress, keccak256, parseAbiParameters, zeroAddress, encodeFunctionData } from 'viem';
import { rpcUrlForChain } from '../../config/network-runtime';
import { validateExpiryCalendar } from './calendar.util';
import { adminContracts, settlementAdapterForFeed } from '../admin-deployment';

import { readAdminFeed } from '../admin-oracle';
import { getIndexedSeriesMetrics } from '../admin-product-metrics';

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
        const [res, metrics] = await Promise.all([this.db.query(
          `SELECT * FROM risk_split_series WHERE chain_id = $1 ORDER BY expiry_timestamp DESC`,
          [chainId]
        ), getIndexedSeriesMetrics(this.db, chainId, 'Risk Split').catch(() => null)]);

        const nowSecs = Math.floor(Date.now() / 1000);

        for (const row of res.rows || []) {
          const underlyingAddr = (row.underlying_address || '').toLowerCase();
          const config = Object.values(TOKEN_FEED_REGISTRY).find(
            (c) => c.tokenAddress.toLowerCase() === underlyingAddr
          );

          const decimals = config?.tokenDecimals ?? 8;
          const symbol = config?.symbol ?? underlyingAddr;

          const floorPriceBig = BigInt(row.floor_price || '0');
          const capPriceBig = BigInt(row.cap_price || '0');
          const refPriceBig = row.creation_reference_price_usd_e8 ? BigInt(row.creation_reference_price_usd_e8) : null;
          const settledPriceBig = row.settled_price ? BigInt(row.settled_price) : null;

          const expiryTs = Number(row.expiry_timestamp);
          const isExpired = nowSecs >= expiryTs;

          const marketMetrics = metrics?.get(row.series_address) ?? null;
          items.push({
            metrics: marketMetrics,
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
            referenceRoundId: row.creation_feed_round_id?.toString() ?? null,
            referenceFeed: row.creation_feed_address ?? null,
            referenceBlock: row.creation_reference_block ? Number(row.creation_reference_block) : null,
            isSettled: Boolean(row.is_settled),
            settledPrice: settledPriceBig ? settledPriceBig.toString() : null,
            settledRoundId: row.settled_round_id ? row.settled_round_id.toString() : null,
            settledFeedUpdatedAt: row.settled_feed_updated_at ? new Date(row.settled_feed_updated_at).toISOString() : null,
            protectedTokenAddress: row.protected_token_address || null,
            upsideTokenAddress: row.upside_token_address || null,
            operationsAuditStatus: row.operations_audit_status || 'NORMAL',
            operationsAuditNote: row.operations_audit_note || null,
            lastIndexedBlock: Math.max(Number(row.last_indexed_block ?? 0), Number(row.created_block ?? 0)),
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch markets from db: ${err}`);
        throw new ServiceUnavailableException('Risk Split series history is unavailable.');
      }
    }

    return {
      data: items,
      asOfBlock,
    };
  }

  private async marketContext(params: AdminRiskSplitSetupRequest) {
    const chainId = params.chainId ?? 8453;
    if (typeof params.underlying !== 'string' || !isAddress(params.underlying) || params.underlying.toLowerCase() === zeroAddress) {
      throw new BadRequestException('Select a valid underlying address.');
    }
    if (!Number.isSafeInteger(params.expiryTimestamp) || params.expiryTimestamp <= 0 || params.expiryTimestamp > 253402300799) {
      throw new BadRequestException('Enter a valid expiry timestamp.');
    }
    const underlying = getAddress(params.underlying);
    const { riskSplit: factoryAddress, assetRegistry } = adminContracts(chainId);
    if (!factoryAddress) throw new BadRequestException('Risk Split factory is not configured.');
    const rpcUrl = rpcUrlForChain(chainId);
    if (!rpcUrl) throw new BadRequestException('Risk Split RPC is not configured.');
    const client = createPublicClient({ transport: http(rpcUrl) });
    const builtIn = Object.values(TOKEN_FEED_REGISTRY).find((item) => item.tokenAddress.toLowerCase() === underlying.toLowerCase());
    const feed = builtIn?.feedAddress ?? reviewedB20FeedAdditions(chainId).get(underlying.toLowerCase());
    if (!feed) throw new BadRequestException('Asset has no reviewed feed.');
    const adapter = settlementAdapterForFeed(feed, 'RISK_SPLIT_SETTLEMENT_ADAPTERS_JSON',
      'RISK_SPLIT_SETTLEMENT_ADAPTER', 'RISK_SPLIT_SETTLEMENT_ADAPTER_ADDRESS');
    try {
      const block = await client.getBlock();
      if (block.number === null) throw new Error('No confirmed block');
      const code = await client.getBytecode({ address: factoryAddress, blockNumber: block.number });
      if (!code || code === '0x') {
        throw new Error('No factory bytecode or block');
      }
      return { chainId, underlying, factoryAddress, assetRegistry, client, builtIn, feed, adapter,
        block: { number: block.number, timestamp: block.timestamp }, expiry: BigInt(params.expiryTimestamp) };
    } catch {
      throw new BadRequestException('Cannot verify the Risk Split factory onchain.');
    }
  }

  private async verifyRegistry(context: Awaited<ReturnType<AdminMarketsService['marketContext']>>) {
    const { client, assetRegistry, chainId, underlying, feed, block } = context;
    const asset = assetRegistry ? await client.readContract({ address: assetRegistry, abi: assetRegistryAbi,
      functionName: 'getAsset', args: [BigInt(chainId), underlying], blockNumber: block.number }).catch(() => null) : null;
    if (!asset?.supported || !asset.isCoinbaseB20 || asset.priceFeed.toLowerCase() !== feed.toLowerCase() ||
        asset.feedDecimals !== 8 || asset.tokenDecimals < 1 || asset.tokenDecimals > 18) {
      throw new BadRequestException('Asset must have a matching reviewed, registry-enabled B20 feed.');
    }
    return asset;
  }

  private async verifyAdapter(context: Awaited<ReturnType<AdminMarketsService['marketContext']>>) {
    const { client, adapter, feed, block } = context;
    if (!adapter) throw new BadRequestException('No Risk Split settlement adapter is configured for this feed.');
    const query = { address: adapter, blockNumber: block.number };
    const [code, adapterFeed, decimals, maxAge] = await Promise.all([
      client.getBytecode(query),
      client.readContract({ ...query, abi: settlementAdapterAbi, functionName: 'priceFeed' }),
      client.readContract({ ...query, abi: settlementAdapterAbi, functionName: 'decimals' }),
      client.readContract({ ...query, abi: settlementAdapterAbi, functionName: 'maxStaleness' }),
    ]).catch(() => [null, null, null, null] as const);
    if (!code || code === '0x' || !adapterFeed || !maxAge) throw new BadRequestException('Settlement adapter is unavailable or invalid.');
    if (adapterFeed.toLowerCase() !== feed.toLowerCase() || decimals !== 8) {
      throw new BadRequestException('Settlement adapter feed or decimals do not match the reviewed asset feed.');
    }
    return { adapter, maxAge };
  }

  async previewSetup(params: AdminRiskSplitSetupRequest): Promise<AdminRiskSplitSetupResponse> {
    const context = await this.marketContext(params);
    const { client, adapter, chainId, underlying, factoryAddress, expiry, block } = context;
    const query = { address: factoryAddress, abi: seriesFactoryAbi, blockNumber: block.number };
    const [adapterApproved, expiryApproved] = await Promise.all([
      adapter ? client.readContract({ ...query, functionName: 'approvedAdapter', args: [underlying, adapter] }) : false,
      client.readContract({ ...query, functionName: 'approvedExpiry', args: [underlying, expiry] }),
    ]).catch(() => { throw new BadRequestException('Cannot read approvals on the owner-only Risk Split factory.'); });
    const registryError = await this.verifyRegistry(context).then(() => null, (error: Error) => error.message);
    const adapterError = await this.verifyAdapter(context).then(() => null, (error: Error) => error.message);
    const calendar = validateExpiryCalendar(params.expiryTimestamp, Number(block.timestamp));
    const adapterBlocker = registryError ?? adapterError;
    const expiryBlocker = registryError ?? (calendar.valid ? null : calendar.error ?? 'Invalid expiry.');
    const transactions: AdminTransactionPreview[] = [];
    if (adapter && (adapterApproved || !adapterBlocker)) {
      const args = [underlying, adapter, !adapterApproved] as const;
      transactions.push({
        description: adapterApproved ? 'Revoke settlement adapter' : 'Approve settlement adapter',
        target: factoryAddress, chainId, method: 'setApprovedAdapter', args: [...args],
        data: encodeFunctionData({ abi: seriesFactoryAbi, functionName: 'setApprovedAdapter', args }),
        expectedState: adapterApproved ? 'Adapter revoked' : 'Adapter approved',
      });
    }
    if (expiryApproved || !expiryBlocker) {
      transactions.push({
        description: expiryApproved ? 'Revoke exact expiry' : 'Approve exact expiry',
        target: factoryAddress, chainId, method: 'setApprovedExpiry', args: [underlying, params.expiryTimestamp, !expiryApproved],
        data: encodeFunctionData({ abi: seriesFactoryAbi, functionName: 'setApprovedExpiry', args: [underlying, expiry, !expiryApproved] }),
        expectedState: expiryApproved ? 'Expiry revoked' : 'Expiry approved',
      });
    }
    return { adapterAddress: adapter, adapterApproved, expiryApproved, adapterBlocker, expiryBlocker, transactions };
  }

  async previewMarket(params: AdminMarketPreviewRequest): Promise<AdminMarketPreviewResponse> {
    const context = await this.marketContext(params);
    const { chainId, client, factoryAddress, underlying, feed, block, expiry, builtIn, assetRegistry } = context;
    if (params.factoryAddress && params.factoryAddress.toLowerCase() !== factoryAddress.toLowerCase()) {
      throw new BadRequestException('Requested factory does not match the configured deployment.');
    }
    const asset = await this.verifyRegistry(context);
    const { adapter: settlementAdapter, maxAge } = await this.verifyAdapter(context);
    if (params.settlementAdapter && params.settlementAdapter.toLowerCase() !== settlementAdapter.toLowerCase()) {
      throw new BadRequestException('Requested adapter does not match the configured deployment.');
    }
    const calendarCheck = validateExpiryCalendar(params.expiryTimestamp, Number(block.timestamp));
    if (!calendarCheck.valid) throw new BadRequestException(calendarCheck.error || 'Invalid expiry calendar specification.');
    const reference = await readAdminFeed(client, feed, block, maxAge < 86400n ? maxAge : 86400n).catch((err) => {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Live reference feed is unavailable.');
    });
    const refPriceBig = reference.price;
    const refRoundIdStr = reference.roundId.toString();
    const refUpdatedAtIso = new Date(Number(reference.updatedAt) * 1000).toISOString();
    const reviewed = builtIn ?? await describeReviewedB20(chainId, underlying, feed, client, assetRegistry);
    const config = { tokenAddress: underlying, tokenDecimals: asset.tokenDecimals, symbol: reviewed?.symbol ?? underlying };

    // 4. Compute / Validate Floor and Cap Prices
    let floorPriceBig: bigint;
    let capPriceBig: bigint;

    if (params.floorPercent !== undefined && params.capPercent !== undefined) {
      if (!Number.isFinite(params.floorPercent) || !Number.isFinite(params.capPercent) ||
          !Number.isSafeInteger(Math.round(params.capPercent * 100)) || params.floorPercent <= 0 || params.capPercent <= params.floorPercent) {
        throw new BadRequestException('Floor percent must be positive and strictly less than cap percent.');
      }
      floorPriceBig = (refPriceBig * BigInt(Math.round(params.floorPercent * 100))) / 10000n;
      capPriceBig = (refPriceBig * BigInt(Math.round(params.capPercent * 100))) / 10000n;
    } else if (typeof params.floorPrice === 'string' && typeof params.capPrice === 'string' &&
        /^\d{1,78}$/.test(params.floorPrice) && /^\d{1,78}$/.test(params.capPrice)) {
      floorPriceBig = BigInt(params.floorPrice);
      capPriceBig = BigInt(params.capPrice);
    } else {
      throw new BadRequestException('Must supply either floorPercent/capPercent or floorPrice/capPrice.');
    }

    if (floorPriceBig <= 0n) {
      throw new BadRequestException('Floor price must be greater than zero.');
    }
    if (capPriceBig >= 2n ** 256n) throw new BadRequestException('Cap price exceeds uint256.');
    if (floorPriceBig >= capPriceBig) {
      throw new BadRequestException('Floor price must be strictly less than cap price.');
    }

    const termKey = keccak256(encodeAbiParameters(parseAbiParameters('address, uint256, uint256, uint256, address'),
      [underlying, floorPriceBig, capPriceBig, expiry, settlementAdapter]));
    const query = { address: factoryAddress, abi: seriesFactoryAbi, blockNumber: block.number };
    const [existing, expiryAlreadyApproved, adapterAlreadyApproved] = await Promise.all([
      client.readContract({ ...query, functionName: 'seriesByTermKey', args: [termKey] }),
      client.readContract({ ...query, functionName: 'approvedExpiry', args: [underlying, expiry] }),
      client.readContract({ ...query, functionName: 'approvedAdapter', args: [underlying, settlementAdapter] }),
    ]).catch(() => { throw new BadRequestException('Cannot verify terms and approvals on the owner-only Risk Split factory.'); });

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

    const duplicateTermsDetected = existing !== zeroAddress;
    const transactions: AdminTransactionPreview[] = [];
    if (expiryAlreadyApproved && adapterAlreadyApproved && !duplicateTermsDetected) {
      transactions.push({
        description: `Create Risk Split Series for ${config.symbol}`,
        target: factoryAddress,
        chainId,
        method: 'createSeries',
        args: [underlying, floorPriceBig.toString(), capPriceBig.toString(), params.expiryTimestamp, settlementAdapter],
        expectedState: 'SeriesCreated emitted with the assigned series address',
      });
    }

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
      adapterAlreadyApproved,
      duplicateTermsDetected,
      payoffScenarios,
      transactions,
    };
  }
}
