import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  addressSchema,
  BasketCapabilities,
  chainIdSchema,
  createPortfolioOnlyCapabilities,
  PositionSnapshot,
  positionSnapshotSchema,
} from '@othelio/shared';
import { createPublicClient, fallback, http, parseAbi } from 'viem';
import { DatabaseService } from '../database/database.service';
import { AAVE_RPC_URLS, AAVE_V3_POOLS } from '../lending/adapters/aave-v3.adapter';
import { BASE_USDC_ADDRESS } from '../config/addresses';
import { rpcUrlForChain } from '../config/network-runtime';

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

const AAVE_POOL_POSITION_ABI = parseAbi([
  'function ADDRESSES_PROVIDER() view returns (address)',
  'function getReservesList() view returns (address[])',
  'function getReserveData(address asset) view returns ((uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)',
]);

const AAVE_PROVIDER_ABI = parseAbi([
  'function getPriceOracle() view returns (address)',
]);

const AAVE_ORACLE_ABI = parseAbi([
  'function BASE_CURRENCY_UNIT() view returns (uint256)',
  'function getAssetPrice(address asset) view returns (uint256)',
]);

const PRICE_FEED_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const ZERO_BLOCK_HASH = `0x${'0'.repeat(64)}` as `0x${string}`;

type Address = `0x${string}`;
type PositionClient = ReturnType<typeof createPublicClient>;

interface AssetRead {
  address: Address;
  symbol?: string;
  decimals: number;
  decimalsKnown: boolean;
  liquid: bigint | null;
  supplied: bigint | null;
  debt: bigint | null;
  priceUsdE8: bigint | null;
  configured: boolean;
}

export interface BasketPositionResponse {
  data: PositionSnapshot;
  capabilities: BasketCapabilities;
}

export interface StalePriceReferenceWarning {
  code: 'STALE_PRICE_REFERENCE';
  lastPriceReferenceAt: string;
  assets: Array<{
    assetAddress: Address;
    priceUsdE8: string;
    feedUpdatedAt: string;
    ageSeconds: number;
    feedRoundId: string;
    quoteBlock: number;
  }>;
}

export interface ActionReadiness {
  warnings: StalePriceReferenceWarning[];
}

@Injectable()
export class BasketPositionService {
  constructor(
    @Inject(DatabaseService)
    private readonly db: DatabaseService,
  ) {}

  protected getClient(chainId: number): PositionClient | null {
    let rpcUrl: string | undefined;
    try {
      rpcUrl = rpcUrlForChain(chainId) ?? AAVE_RPC_URLS[chainId];
    } catch {
      return null;
    }
    if (!rpcUrl) return null;
    const transportOptions = { retryCount: 1, retryDelay: 500, timeout: 4_000 } as const;
    const transport = chainId === 8453
      ? fallback([
          http(rpcUrl, transportOptions),
          http('https://mainnet.base.org', transportOptions),
        ])
      : http(rpcUrl, transportOptions);
    return createPublicClient({ transport });
  }

  async getIndexedPositionSnapshot(
    basketAddressInput: string,
    chainIdInput: string | number,
    additionalAssetInputs: string[] = [],
  ): Promise<BasketPositionResponse> {
    let basketAddress: Address;
    let chainId: number;
    try {
      basketAddress = addressSchema.parse(basketAddressInput).toLowerCase() as Address;
      chainId = chainIdSchema.parse(chainIdInput);
    } catch {
      throw new BadRequestException('basketAddress and chainId must be valid EVM values.');
    }
    const additionalAssets = additionalAssetInputs.map((asset) => {
      try {
        return addressSchema.parse(asset).toLowerCase() as Address;
      } catch {
        throw new BadRequestException('Every additional asset must be a valid EVM address.');
      }
    });
    const snapshot = await this.lastKnownSnapshot(chainId, basketAddress, 'INDEXED_SNAPSHOT', additionalAssets);
    if (snapshot) return { data: snapshot, capabilities: this.resolveRecoveryCapabilities(chainId, snapshot) };
    const unavailable = this.unavailableSnapshot(chainId, basketAddress, 'INDEXED_SNAPSHOT_UNAVAILABLE');
    return { data: unavailable, capabilities: this.getCapabilities(chainId) };
  }

  /** Action gate: page reads never call this method. */
  async assertActionReadiness(
    chainId: number,
    basketAddress: Address,
    assets: Address[] = [],
    expectedPrices: Map<string, string | null> = new Map(),
  ): Promise<ActionReadiness> {
    const checkpoint = await this.db.query(
      `SELECT next_block,observed_head_block,observed_head_at
       FROM indexer_worker_state
       WHERE chain_id=$1 AND worker_name='events'
       LIMIT 1`,
      [chainId],
    );
    const head = checkpoint.rows[0]?.next_block == null ? null : Number(checkpoint.rows[0].next_block) - 1;
    if (head == null) throw new ConflictException({ code: 'INDEXER_LAGGING', error: 'INDEXER_LAGGING' });
    const observedHead = checkpoint.rows[0]?.observed_head_block == null
      ? null
      : Number(checkpoint.rows[0].observed_head_block);
    const observedHeadAt = checkpoint.rows[0]?.observed_head_at == null
      ? null
      : new Date(checkpoint.rows[0].observed_head_at).getTime();
    const configuredHeadMaxAge = Number(process.env.INDEXER_HEAD_OBSERVATION_MAX_AGE_SECS ?? 30);
    const headMaxAgeMs = (Number.isFinite(configuredHeadMaxAge)
      ? Math.max(5, Math.floor(configuredHeadMaxAge))
      : 30) * 1_000;
    let client: PositionClient | null = null;
    let chainHead: number;
    if (observedHead !== null && observedHeadAt !== null && Date.now() - observedHeadAt <= headMaxAgeMs) {
      chainHead = observedHead;
    } else {
      client = this.getClient(chainId);
      try {
        if (!client) throw new Error('RPC client unavailable');
        chainHead = Number(await client.getBlockNumber());
      } catch {
        throw new ConflictException({ code: 'CHAIN_HEAD_UNAVAILABLE', error: 'CHAIN_HEAD_UNAVAILABLE' });
      }
    }
    // The indexer commits canonical checkpoints in 10-block ranges on Base
    // (BATCH_SIZE=9). Allow one normal range to be outstanding; reject only
    // when the indexer is beyond its expected catch-up window.
    const configuredMaxLag = Number(process.env.INDEXER_ACTION_MAX_LAG_BLOCKS ?? 10);
    const maxIndexerLag = Number.isFinite(configuredMaxLag)
      ? Math.max(1, Math.floor(configuredMaxLag))
      : 10;
    if (chainHead - head > maxIndexerLag) {
      throw new ConflictException({ code: 'INDEXER_LAGGING', error: 'INDEXER_LAGGING' });
    }
    const uniqueAssets = Array.from(new Set(assets.map((asset) => asset.toLowerCase()))) as Address[];
    const priceAssets = uniqueAssets.filter((asset) => asset !== BASE_USDC_ADDRESS.toLowerCase());
    const warnings: StalePriceReferenceWarning[] = [];
    if (priceAssets.length > 0) {
      const prices = await this.db.query(
        `SELECT DISTINCT ON (LOWER(asset_address))
           LOWER(asset_address) AS asset_address,
           block_number,
           feed_updated_at,
           price_usd_e8,
           feed_round_id
         FROM asset_price_observations
         WHERE chain_id=$1 AND LOWER(asset_address)=ANY($2::text[])
         ORDER BY LOWER(asset_address),block_number DESC,observed_at DESC,block_hash DESC`,
        [chainId, priceAssets],
      );
      const byAsset = new Map(prices.rows.map((row) => [String(row.asset_address).trim().toLowerCase(), {
        blockNumber: Number(row.block_number),
        feedUpdatedAt: row.feed_updated_at == null ? null : new Date(row.feed_updated_at),
        priceUsdE8: row.price_usd_e8 == null ? null : String(row.price_usd_e8),
        feedRoundId: row.feed_round_id == null ? null : String(row.feed_round_id),
      }]));
      const configuredPriceMaxLag = process.env.PRICE_SNAPSHOT_MAX_LAG_BLOCKS
        ? Number(process.env.PRICE_SNAPSHOT_MAX_LAG_BLOCKS)
        : null;
      const configuredMaxAge = Number(process.env.MAX_PRICE_FEED_AGE_SECS ?? 2 * 3_600);
      const staleAgeSeconds = Number.isFinite(configuredMaxAge) ? Math.max(0, Math.floor(configuredMaxAge)) : 2 * 3_600;
      const contractMaxAge = Number(process.env.ONCHAIN_MAX_PRICE_FEED_AGE_SECS ?? 7 * 24 * 3_600);
      const contractMaxAgeMs = (Number.isFinite(contractMaxAge) ? contractMaxAge : 7 * 24 * 3_600) * 1_000;
      const unavailableAssets = priceAssets.filter((asset) => {
        const price = byAsset.get(asset);
        if (!price || !price.feedUpdatedAt || !Number.isFinite(price.feedUpdatedAt.getTime())
          || !price.priceUsdE8 || !price.feedRoundId) {
          return true;
        }
        let validPrice = false;
        try { validPrice = BigInt(price.priceUsdE8) > 0n; } catch { validPrice = false; }
        if (!validPrice || price.feedUpdatedAt.getTime() > Date.now()) return true;
        const expectedPrice = expectedPrices.get(asset);
        if (expectedPrice !== undefined && expectedPrice !== price.priceUsdE8) return true;
        if (Date.now() - price.feedUpdatedAt.getTime() > contractMaxAgeMs) {
          return true;
        }
        if (configuredPriceMaxLag !== null && head - price.blockNumber > configuredPriceMaxLag) {
          return true;
        }
        return false;
      });
      if (unavailableAssets.length > 0) {
        throw new ConflictException({
          code: 'PRICE_SNAPSHOT_STALE',
          error: 'PRICE_SNAPSHOT_STALE',
          assets: unavailableAssets,
          indexedPriceBlocks: Object.fromEntries(unavailableAssets.map((asset) => [asset, byAsset.get(asset)?.blockNumber ?? null])),
          indexedHead: head,
        });
      }

      const now = Date.now();
      const staleReferences = priceAssets.flatMap((asset) => {
        const price = byAsset.get(asset)!;
        const feedUpdatedAt = price.feedUpdatedAt!;
        const ageSeconds = Math.max(0, Math.floor((now - feedUpdatedAt.getTime()) / 1_000));
        return ageSeconds > staleAgeSeconds
          ? [{ assetAddress: asset, priceUsdE8: price.priceUsdE8!, feedUpdatedAt: feedUpdatedAt.toISOString(), ageSeconds, feedRoundId: price.feedRoundId!, quoteBlock: price.blockNumber }]
          : [];
      });
      if (staleReferences.length > 0) {
        warnings.push({
          code: 'STALE_PRICE_REFERENCE',
          lastPriceReferenceAt: staleReferences.reduce(
            (oldest, reference) => reference.feedUpdatedAt < oldest ? reference.feedUpdatedAt : oldest,
            staleReferences[0].feedUpdatedAt,
          ),
          assets: staleReferences,
        });
      }
    }
    // New target assets and a funding token may not have a basket_positions row
    // yet. They represent an indexed zero balance, not an unknown balance. Only
    // assets that are actually held need reconciliation verification.
    const indexedPositions = await this.db.query(
      `SELECT DISTINCT LOWER(asset_address) AS asset_address
       FROM basket_positions
       WHERE chain_id=$1 AND basket_address=$2 AND LOWER(asset_address)=ANY($3::text[])`,
      [chainId, basketAddress, uniqueAssets],
    );
    const trackedAssets = uniqueAssets.filter((asset) => indexedPositions.rows.some((row) => String(row.asset_address).trim().toLowerCase() === asset));
    const reconciliation = trackedAssets.length === 0
      ? { rows: [] }
      : await this.db.query(`SELECT asset_address,last_checked_block,status FROM indexer_reconciliation_state WHERE chain_id=$1 AND basket_address=$2 AND LOWER(asset_address)=ANY($3::text[])`, [chainId, basketAddress, trackedAssets]);
    const byAsset = new Map(reconciliation.rows.map((row) => [String(row.asset_address).trim().toLowerCase(), { block: Number(row.last_checked_block), status: String(row.status) }]));
    if (trackedAssets.some((asset) => !byAsset.has(asset))) throw new ConflictException({ code: 'BALANCE_REFRESH_FAILED', error: 'BALANCE_REFRESH_FAILED', reason: 'RECONCILIATION_STATE_UNKNOWN' });
    if (trackedAssets.some((asset) => byAsset.get(asset)!.status === 'PENDING')) throw new ConflictException({ code: 'BALANCE_REFRESH_FAILED', error: 'BALANCE_REFRESH_FAILED', reason: 'RECONCILIATION_STATE_UNKNOWN' });
    const needsRefresh = trackedAssets.filter((asset) => { const state = byAsset.get(asset)!; return state.status === 'DEGRADED' || head - state.block > 150; });
    if (needsRefresh.length === 0) return { warnings };
    client ??= this.getClient(chainId);
    if (!client) throw new ConflictException({ code: 'BALANCE_REFRESH_FAILED', error: 'BALANCE_REFRESH_FAILED' });
    try {
      const refreshed = await client.multicall({ contracts: needsRefresh.map((asset) => ({ address: asset, abi: ERC20_ABI, functionName: 'balanceOf', args: [basketAddress] })) });
      const indexed = await this.db.query(`SELECT DISTINCT ON (asset_address) asset_address,quantity_base_units FROM basket_positions WHERE chain_id=$1 AND basket_address=$2 AND LOWER(asset_address)=ANY($3::text[]) ORDER BY asset_address,block_number DESC,observed_at DESC,block_hash DESC`, [chainId, basketAddress, needsRefresh.map((asset) => asset.toLowerCase())]);
      const indexedByAsset = new Map(indexed.rows.map((row) => [String(row.asset_address).trim().toLowerCase(), BigInt(row.quantity_base_units)]));
      for (let index = 0; index < needsRefresh.length; index += 1) {
        const result = refreshed[index];
        const indexedValue = indexedByAsset.get(needsRefresh[index].toLowerCase()) ?? 0n;
        if (result.status !== 'success' || indexedValue !== BigInt(result.result as unknown as bigint)) {
          throw new Error('targeted balance differs from indexed position');
        }
      }
    } catch {
      throw new ConflictException({ code: 'BALANCE_REFRESH_FAILED', error: 'BALANCE_REFRESH_FAILED' });
    }
    return { warnings };
  }

  async getPositionSnapshot(
    basketAddressInput: string,
    chainIdInput: string | number,
    additionalAssetInputs: string[] = [],
  ): Promise<BasketPositionResponse> {
    let basketAddress: Address;
    let chainId: number;
    try {
      basketAddress = addressSchema.parse(basketAddressInput).toLowerCase() as Address;
      chainId = chainIdSchema.parse(chainIdInput);
    } catch {
      throw new BadRequestException('basketAddress and chainId must be valid EVM values.');
    }
    const additionalAssets = additionalAssetInputs.map((asset) => {
      try {
        return addressSchema.parse(asset).toLowerCase() as Address;
      } catch {
        throw new BadRequestException('Every additional asset must be a valid EVM address.');
      }
    });
    const client = this.getClient(chainId);

    if (!client) {
      return this.withLastKnownSnapshot(chainId, basketAddress, `RPC_UNCONFIGURED:${chainId}`, additionalAssets);
    }

    let block: Awaited<ReturnType<PositionClient['getBlock']>>;
    try {
      block = await client.getBlock({ blockTag: 'latest' });
    } catch {
      return this.withLastKnownSnapshot(chainId, basketAddress, 'RPC_BLOCK_UNAVAILABLE', additionalAssets);
    }

    const blockNumber = block.number;
    const blockHash = block.hash;
    if (blockNumber === null || blockHash === null) {
      return this.withLastKnownSnapshot(chainId, basketAddress, 'RPC_BLOCK_NOT_CANONICAL', additionalAssets);
    }

    const basketCode = await client.getBytecode({ address: basketAddress, blockNumber }).catch(() => undefined);
    if (!basketCode || basketCode === '0x') {
      throw new ConflictException(
        'BASKET_NOT_DEPLOYED_ON_CHAIN: the indexed basket does not exist on the current RPC chain. Recreate it after resetting or redeploying Anvil.',
      );
    }

    const issues: string[] = [];
    const configuredAssets = await this.getConfiguredAssets(chainId, basketAddress, blockNumber, issues);
    // Aave remains write-disabled in the product UI, but existing positions must
    // be discovered accurately so recovery actions can later be enabled safely.
    const poolAddress = AAVE_V3_POOLS[chainId];
    const reserveAssets = poolAddress
      ? await this.getAaveReserves(client, poolAddress, blockNumber, issues)
      : [];
    const aaveHealthFactorRay = poolAddress
      ? await this.getAaveHealthFactor(client, poolAddress, basketAddress, blockNumber, issues)
      : null;

    const configuredKeys = new Set(configuredAssets.map((address) => address.toLowerCase()));
    const universe = new Map<string, Address>();
    for (const address of [...configuredAssets, ...additionalAssets, ...reserveAssets]) {
      universe.set(address.toLowerCase(), address.toLowerCase() as Address);
    }

    const oracle = poolAddress
      ? await this.getAaveOracle(client, poolAddress, blockNumber, issues)
      : null;

    const priceFeeds = new Map<string, Address>();
    try {
      const priceRows = await this.db.query(
        `SELECT DISTINCT ON (LOWER(asset_address))
           LOWER(asset_address) AS asset_address,
           LOWER(feed_address) AS feed_address
         FROM asset_price_observations
         WHERE chain_id = $1
         ORDER BY LOWER(asset_address), block_number DESC`,
        [chainId],
      );
      for (const row of priceRows.rows) {
        const parsedAddress = addressSchema.safeParse(row.asset_address.trim());
        if (parsedAddress.success) {
          const address = parsedAddress.data.toLowerCase() as Address;
          universe.set(address, address);
          const parsedFeed = addressSchema.safeParse(row.feed_address.trim());
          if (parsedFeed.success) priceFeeds.set(address, parsedFeed.data.toLowerCase() as Address);
        }
      }
    } catch {
      issues.push('ASSET_PRICE_FEED_DISCOVERY_UNAVAILABLE');
    }

    const reads = await Promise.all(
      [...universe.values()].map((assetAddress) => this.readAsset(
        client,
        chainId,
        basketAddress,
        assetAddress,
        configuredKeys.has(assetAddress.toLowerCase()),
        reserveAssets.some((reserve) => reserve.toLowerCase() === assetAddress.toLowerCase()),
        poolAddress,
        oracle,
        priceFeeds.get(assetAddress.toLowerCase()),
        blockNumber,
        block.timestamp,
        issues,
      )),
    );

    const additionalKeys = new Set(additionalAssets.map((address) => address.toLowerCase()));
    // Price-feed discovery can add assets observed by other baskets. They are
    // not part of this basket and may not even be deployed on this chain. Do
    // not let an unreadable zero-balance discovery candidate make this basket's
    // live valuation unusable; configured and explicitly requested assets are
    // still retained and validated strictly.
    const visibleReads = reads.filter((read) =>
      read.configured || additionalKeys.has(read.address.toLowerCase()) ||
      read.liquid !== null || read.supplied !== null || read.debt !== null,
    );

    let grossAssets = 0n;
    let accruedDebt = 0n;
    // Owner-controlled accounts can interact with protocols outside the configured Aave pool.
    // Until deployment inventory proves otherwise, aggregate debt/equity cannot be called complete.
    let totalsKnown = true;
    for (const read of visibleReads) {
      if (!read.decimalsKnown || read.liquid === null || read.supplied === null || read.debt === null) {
        totalsKnown = false;
        continue;
      }
      const grossAmount = read.liquid + read.supplied;
      if ((grossAmount > 0n || read.debt > 0n) && read.priceUsdE8 === null) {
        totalsKnown = false;
        continue;
      }
      if (read.priceUsdE8 !== null) {
        const scale = 10n ** BigInt(read.decimals);
        grossAssets += (grossAmount * read.priceUsdE8) / scale;
        accruedDebt += (read.debt * read.priceUsdE8) / scale;
      }
    }

    const readCompleteness = visibleReads.some((read) => !read.decimalsKnown || read.liquid === null)
      ? 'PARTIAL'
      : 'COMPLETE';
    const valuationStatus = totalsKnown
      ? 'COMPLETE'
      : visibleReads.some((read) => read.priceUsdE8 !== null)
        ? 'PARTIAL'
        : 'UNAVAILABLE';

    const snapshot = positionSnapshotSchema.parse({
      chainId,
      basketAddress,
      blockNumber: Number(blockNumber),
      blockHash,
      observedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
      tokens: visibleReads.map((read) => ({
        assetAddress: read.address,
        symbol: read.symbol,
        decimals: read.decimals,
        liquidAmountBaseUnits: read.liquid?.toString() ?? null,
        priceUsdE8: read.priceUsdE8?.toString() ?? null,
      })),
      markets: poolAddress
        ? visibleReads
            .filter((read) => reserveAssets.some((reserve) => reserve.toLowerCase() === read.address.toLowerCase()))
            .map((read) => ({
              identity: {
                chainId,
                basketAddress,
                protocol: 'AAVE_V3',
                marketAddress: poolAddress,
                assetAddress: read.address,
              },
              suppliedAmountBaseUnits: read.supplied?.toString() ?? null,
              accruedDebtAmountBaseUnits: read.debt?.toString() ?? null,
            }))
        : [],
      grossAssetsUsdE8: totalsKnown ? grossAssets.toString() : null,
      accruedDebtUsdE8: totalsKnown ? accruedDebt.toString() : null,
      equityUsdE8: totalsKnown ? (grossAssets - accruedDebt).toString() : null,
      aaveHealthFactorRay: aaveHealthFactorRay?.toString() ?? null,
      readCompleteness,
      valuationStatus,
      issues: [...new Set(issues)].sort(),
    });

    const configuredKeysForFallback = new Set(configuredAssets.map((asset) => asset.toLowerCase()));
    const configuredLiquidDataMissing = snapshot.tokens.some((token) =>
      configuredKeysForFallback.has(token.assetAddress.toLowerCase()) &&
      (token.liquidAmountBaseUnits === null || token.priceUsdE8 === null),
    );
    if (snapshot.readCompleteness === 'UNAVAILABLE' || configuredLiquidDataMissing) {
      const fallback = await this.lastKnownSnapshot(chainId, basketAddress, snapshot.issues[0] ?? 'LIVE_VALUATION_UNAVAILABLE');
      if (fallback) return { data: fallback, capabilities: this.resolveRecoveryCapabilities(chainId, fallback) };
    }
    return { data: snapshot, capabilities: this.resolveRecoveryCapabilities(chainId, snapshot) };
  }

  private getCapabilities(chainId: number): BasketCapabilities {
    const capabilities = createPortfolioOnlyCapabilities(chainId, 'legacy-or-v2-owner-account-unverified');
    for (const action of ['SUPPLY', 'BORROW', 'REINVEST'] as const) {
      capabilities.actions[action].enforcement.api = true;
      capabilities.actions[action].enforcement.onchain = false;
    }
    return capabilities;
  }

  private resolveRecoveryCapabilities(chainId: number, snapshot: PositionSnapshot): BasketCapabilities {
    const capabilities = this.getCapabilities(chainId);
    const configuredPool = AAVE_V3_POOLS[chainId]?.toLowerCase();
    if (!configuredPool) return capabilities;

    const liquidByAsset = new Map(snapshot.tokens.map((token) => [
      token.assetAddress.toLowerCase(),
      token.liquidAmountBaseUnits,
    ]));
    const exactPositions = snapshot.markets.filter((position) => (
      position.identity.protocol === 'AAVE_V3'
      && position.identity.marketAddress.toLowerCase() === configuredPool
    ));
    const repayable = exactPositions.find((position) => {
      const debt = position.accruedDebtAmountBaseUnits;
      const liquid = liquidByAsset.get(position.identity.assetAddress.toLowerCase());
      return debt !== null && BigInt(debt) > 0n && typeof liquid === 'string' && BigInt(liquid) > 0n;
    });
    if (repayable) {
      const debt = BigInt(repayable.accruedDebtAmountBaseUnits!);
      const liquid = BigInt(liquidByAsset.get(repayable.identity.assetAddress.toLowerCase())!);
      capabilities.actions.REPAY = {
        ...capabilities.actions.REPAY,
        availability: 'AVAILABLE',
        reason: `Verified Aave V3 debt may be repaid from known basket liquidity up to ${debt < liquid ? debt : liquid} base units for the exact market asset.`,
        policySource: 'VERIFIED_AAVE_V3_POSITION',
        enforcement: { api: true, onchain: false },
      };
    } else {
      capabilities.actions.REPAY = {
        ...capabilities.actions.REPAY,
        reason: 'Repayment requires exact configured Aave V3 identity, verified nonzero debt, and known nonzero basket liquidity in the debt asset.',
        enforcement: { api: true, onchain: false },
      };
    }

    const releasable = exactPositions.find((position) => (
      position.suppliedAmountBaseUnits !== null
      && BigInt(position.suppliedAmountBaseUnits) > 0n
      && position.accruedDebtAmountBaseUnits !== null
      && BigInt(position.accruedDebtAmountBaseUnits) === 0n
    ));
    if (releasable) {
      capabilities.actions.RELEASE_COLLATERAL = {
        ...capabilities.actions.RELEASE_COLLATERAL,
        availability: 'AVAILABLE',
        reason: `Verified debt-free Aave V3 collateral may be released up to ${releasable.suppliedAmountBaseUnits} base units for its exact market asset.`,
        policySource: 'VERIFIED_AAVE_V3_POSITION',
        enforcement: { api: true, onchain: false },
      };
    } else {
      capabilities.actions.RELEASE_COLLATERAL = {
        ...capabilities.actions.RELEASE_COLLATERAL,
        reason: 'Collateral release requires exact configured Aave V3 identity, a known supplied amount, and verified zero debt. No safe withdrawable bound is available while debt exists.',
        enforcement: { api: true, onchain: false },
      };
    }
    return capabilities;
  }

  private unavailableSnapshot(chainId: number, basketAddress: Address, issue: string): PositionSnapshot {
    return positionSnapshotSchema.parse({
      chainId,
      basketAddress,
      blockNumber: 0,
      blockHash: ZERO_BLOCK_HASH,
      observedAt: new Date().toISOString(),
      tokens: [],
      markets: [],
      grossAssetsUsdE8: null,
      accruedDebtUsdE8: null,
      equityUsdE8: null,
      readCompleteness: 'UNAVAILABLE',
      valuationStatus: 'UNAVAILABLE',
      issues: [issue, 'POSITION_DISCOVERY_NOT_PROOF_OF_ZERO_DEBT'],
    });
  }

  private async withLastKnownSnapshot(
    chainId: number,
    basketAddress: Address,
    issue: string,
    additionalAssets: Address[] = [],
  ): Promise<BasketPositionResponse> {
    const snapshot = await this.lastKnownSnapshot(chainId, basketAddress, issue, additionalAssets);
    if (snapshot) return { data: snapshot, capabilities: this.resolveRecoveryCapabilities(chainId, snapshot) };
    const unavailable = this.unavailableSnapshot(chainId, basketAddress, issue);
    return { data: unavailable, capabilities: this.getCapabilities(chainId) };
  }

  private async lastKnownSnapshot(
    chainId: number,
    basketAddress: Address,
    issue: string,
    additionalAssets: Address[] = [],
  ): Promise<PositionSnapshot | null> {
    try {
      const result = await this.db.query(
        `WITH latest_nav AS (
           SELECT block_number, block_hash, block_timestamp, position_block_number, nav_usdc
           FROM basket_nav_observations
           WHERE chain_id = $1 AND basket_address = $2 AND valuation_status = 'COMPLETE'
           ORDER BY block_number DESC, kind DESC, observed_at DESC, block_hash DESC
           LIMIT 1
         ), latest_positions AS (
           SELECT DISTINCT ON (bp.asset_address)
             bp.asset_address, bp.quantity_base_units, bp.decimals
           FROM basket_positions bp, latest_nav nav
           WHERE bp.chain_id = $1 AND bp.basket_address = $2 AND bp.block_number <= nav.position_block_number
           ORDER BY bp.asset_address, bp.block_number DESC, bp.observed_at DESC, bp.block_hash DESC
         ), latest_prices AS (
           SELECT DISTINCT ON (apo.asset_address)
             apo.asset_address, apo.price_usd_e8
           FROM asset_price_observations apo
           WHERE apo.chain_id = $1
           ORDER BY apo.asset_address, apo.block_number DESC, apo.observed_at DESC, apo.block_hash DESC
         )
         SELECT nav.block_number, nav.block_hash, nav.block_timestamp,
                nav.nav_usdc,
                lp.asset_address, lp.quantity_base_units, lp.decimals,
                lpr.price_usd_e8
         FROM latest_nav nav
         LEFT JOIN latest_positions lp ON TRUE
         LEFT JOIN latest_prices lpr ON LOWER(lpr.asset_address) = LOWER(lp.asset_address)
         ORDER BY lp.asset_address`,
        [chainId, basketAddress],
      );
      if (result.rows.length === 0 || !result.rows[0].block_number) return null;
      const first = result.rows[0];
      const tokens = result.rows
        .filter((row) => row.asset_address)
        .map((row) => ({
          assetAddress: String(row.asset_address).trim().toLowerCase(),
          decimals: Number(row.decimals),
          liquidAmountBaseUnits: String(row.quantity_base_units),
          priceUsdE8: row.price_usd_e8 === null ? null : String(row.price_usd_e8),
        }));

      if (additionalAssets.length > 0) {
        const presentAssets = new Set(tokens.map((token) => token.assetAddress.toLowerCase()));
        const missingAdditionalAssets = Array.from(
          new Set(
            additionalAssets
              .map((asset) => asset.toLowerCase())
              .filter((asset) => !presentAssets.has(asset)),
          ),
        );

        if (missingAdditionalAssets.length > 0) {
          const priceRows = await this.db.query(
            `SELECT DISTINCT ON (LOWER(asset_address))
               LOWER(asset_address) AS asset_address,
               price_usd_e8
             FROM asset_price_observations
             WHERE chain_id = $1 AND LOWER(asset_address) = ANY($2::text[])
             ORDER BY LOWER(asset_address), block_number DESC, observed_at DESC, block_hash DESC`,
            [chainId, missingAdditionalAssets],
          );
          const pricesByAsset = new Map<string, string | null>(
            priceRows.rows.map((row) => [
              String(row.asset_address).trim().toLowerCase(),
              row.price_usd_e8 == null ? null : String(row.price_usd_e8),
            ]),
          );

          const decimalsRows = await this.db.query(
            `SELECT DISTINCT ON (LOWER(asset_address))
               LOWER(asset_address) AS asset_address,
               decimals
             FROM basket_positions
             WHERE chain_id = $1 AND LOWER(asset_address) = ANY($2::text[])
             ORDER BY LOWER(asset_address), block_number DESC`,
            [chainId, missingAdditionalAssets],
          );
          const decimalsByAsset = new Map<string, number>(
            decimalsRows.rows.map((row) => [
              String(row.asset_address).trim().toLowerCase(),
              Number(row.decimals),
            ]),
          );

          for (const missingAsset of missingAdditionalAssets) {
            let decimals = decimalsByAsset.get(missingAsset);
            if (decimals === undefined) {
              decimals = missingAsset === BASE_USDC_ADDRESS.toLowerCase() ? 6 : 8;
            }
            tokens.push({
              assetAddress: missingAsset,
              decimals,
              liquidAmountBaseUnits: '0',
              priceUsdE8: pricesByAsset.get(missingAsset) ?? null,
            });
          }
        }
      }

      const navUsdE8 = tokens.reduce((total, token) => {
        if (token.priceUsdE8 === null) return total;
        return total + (BigInt(token.liquidAmountBaseUnits ?? '0') * BigInt(token.priceUsdE8)) / (BigInt(10) ** BigInt(token.decimals));
      }, 0n).toString();
      return positionSnapshotSchema.parse({
        chainId,
        basketAddress,
        blockNumber: Number(first.block_number),
        blockHash: String(first.block_hash).trim(),
        observedAt: new Date(first.block_timestamp).toISOString(),
        tokens,
        markets: [],
        grossAssetsUsdE8: navUsdE8,
        accruedDebtUsdE8: '0',
        equityUsdE8: navUsdE8,
        aaveHealthFactorRay: null,
        readCompleteness: 'COMPLETE',
        valuationStatus: tokens.every((token) => token.priceUsdE8 !== null) ? 'COMPLETE' : 'PARTIAL',
        issues: [issue, 'LAST_KNOWN_GOOD_SNAPSHOT'],
      });
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Position snapshot] Indexed snapshot read failed:', error);
      }
      return null;
    }
  }

  private async getConfiguredAssets(
    chainId: number,
    basketAddress: Address,
    blockNumber: bigint,
    issues: string[],
  ): Promise<Address[]> {
    try {
      const result = await this.db.query(
        'SELECT asset_address FROM basket_assets WHERE chain_id=$1 AND basket_address=$2 AND updated_block <= $3 ORDER BY asset_address',
        [chainId, basketAddress, blockNumber.toString()],
      );
      return result.rows
        .map((row) => addressSchema.safeParse(row.asset_address))
        .filter((parsed) => parsed.success)
        .map((parsed) => parsed.data.toLowerCase() as Address);
    } catch {
      issues.push('BASKET_ASSET_REGISTRY_UNAVAILABLE');
      return [];
    }
  }

  private async getAaveReserves(
    client: PositionClient,
    poolAddress: Address,
    blockNumber: bigint,
    issues: string[],
  ): Promise<Address[]> {
    try {
      return [...await client.readContract({
        address: poolAddress,
        abi: AAVE_POOL_POSITION_ABI,
        functionName: 'getReservesList',
        blockNumber,
      })].map((address) => address.toLowerCase() as Address);
    } catch {
      issues.push(`AAVE_RESERVE_DISCOVERY_UNAVAILABLE:${poolAddress}`);
      return [];
    }
  }

  private async getAaveHealthFactor(
    client: PositionClient,
    poolAddress: Address,
    basketAddress: Address,
    blockNumber: bigint,
    issues: string[],
  ): Promise<bigint | null> {
    try {
      const account = await client.readContract({
        address: poolAddress,
        abi: AAVE_POOL_POSITION_ABI,
        functionName: 'getUserAccountData',
        args: [basketAddress],
        blockNumber,
      });
      return account[5];
    } catch {
      issues.push(`AAVE_HEALTH_FACTOR_UNAVAILABLE:${poolAddress}`);
      return null;
    }
  }

  private async getAaveOracle(
    client: PositionClient,
    poolAddress: Address,
    blockNumber: bigint,
    issues: string[],
  ): Promise<{ address: Address; baseUnit: bigint } | null> {
    try {
      const providerAddress = await client.readContract({
        address: poolAddress,
        abi: AAVE_POOL_POSITION_ABI,
        functionName: 'ADDRESSES_PROVIDER',
        blockNumber,
      });
      const oracleAddress = await client.readContract({
        address: providerAddress,
        abi: AAVE_PROVIDER_ABI,
        functionName: 'getPriceOracle',
        blockNumber,
      });
      const baseUnit = await client.readContract({
        address: oracleAddress,
        abi: AAVE_ORACLE_ABI,
        functionName: 'BASE_CURRENCY_UNIT',
        blockNumber,
      });
      if (baseUnit === 0n) throw new Error('zero base unit');
      return { address: oracleAddress, baseUnit };
    } catch {
      issues.push(`AAVE_PRICE_ORACLE_UNAVAILABLE:${poolAddress}`);
      return null;
    }
  }

  private async readAsset(
    client: PositionClient,
    chainId: number,
    basketAddress: Address,
    assetAddress: Address,
    configured: boolean,
    isAaveReserve: boolean,
    poolAddress: Address | undefined,
    oracle: { address: Address; baseUnit: bigint } | null,
    priceFeedAddress: Address | undefined,
    blockNumber: bigint,
    blockTimestamp: bigint,
    issues: string[],
  ): Promise<AssetRead> {
    const [liquidResult, decimalsResult, symbolResult] = await Promise.allSettled([
      client.readContract({ address: assetAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [basketAddress], blockNumber }),
      client.readContract({ address: assetAddress, abi: ERC20_ABI, functionName: 'decimals', blockNumber }),
      client.readContract({ address: assetAddress, abi: ERC20_ABI, functionName: 'symbol', blockNumber }),
    ]);
    const liquid = liquidResult.status === 'fulfilled' ? liquidResult.value : null;
    const decimalsKnown = decimalsResult.status === 'fulfilled';
    const decimals = decimalsKnown ? Number(decimalsResult.value) : 18;
    // ERC-20 symbol metadata is optional in the snapshot schema.  Do not expose an empty
    // string (which violates the shared contract), and do not fabricate a ticker from an address.
    const symbolValue = symbolResult.status === 'fulfilled' ? symbolResult.value : undefined;
    const symbol = typeof symbolValue === 'string' && symbolValue.trim().length > 0 ? symbolValue.trim() : undefined;
    if (liquid === null) issues.push(`TOKEN_BALANCE_UNAVAILABLE:${assetAddress}`);
    if (!decimalsKnown) issues.push(`TOKEN_DECIMALS_UNAVAILABLE:${assetAddress}`);
    if (!symbol) issues.push(`TOKEN_SYMBOL_UNAVAILABLE:${assetAddress}`);

    let supplied: bigint | null = 0n;
    let debt: bigint | null = 0n;
    if (isAaveReserve && poolAddress) {
      try {
        const reserveData = await client.readContract({
          address: poolAddress,
          abi: AAVE_POOL_POSITION_ABI,
          functionName: 'getReserveData',
          args: [assetAddress],
          blockNumber,
        });
        const aToken = reserveData.aTokenAddress;
        const stableDebtToken = reserveData.stableDebtTokenAddress;
        const variableDebtToken = reserveData.variableDebtTokenAddress;
        const [supplyResult, stableDebtResult, variableDebtResult] = await Promise.allSettled([
          this.readOptionalBalance(client, aToken, basketAddress, blockNumber),
          this.readOptionalBalance(client, stableDebtToken, basketAddress, blockNumber),
          this.readOptionalBalance(client, variableDebtToken, basketAddress, blockNumber),
        ]);
        supplied = supplyResult.status === 'fulfilled' ? supplyResult.value : null;
        debt = stableDebtResult.status === 'fulfilled' && variableDebtResult.status === 'fulfilled'
          ? stableDebtResult.value + variableDebtResult.value
          : null;
      } catch {
        supplied = null;
        debt = null;
      }
      if (supplied === null) issues.push(`AAVE_SUPPLY_UNAVAILABLE:${poolAddress}:${assetAddress}`);
      if (debt === null) issues.push(`AAVE_DEBT_UNAVAILABLE:${poolAddress}:${assetAddress}`);
    }

    let priceUsdE8: bigint | null = null;
    if (priceFeedAddress) {
      try {
        const [feedDecimals, round] = await Promise.all([
          client.readContract({ address: priceFeedAddress, abi: PRICE_FEED_ABI, functionName: 'decimals', blockNumber }),
          client.readContract({ address: priceFeedAddress, abi: PRICE_FEED_ABI, functionName: 'latestRoundData', blockNumber }),
        ]);
        const [roundId, answer, , updatedAt, answeredInRound] = round;
        if (feedDecimals > 36 || roundId === 0n || answer <= 0n || answeredInRound < roundId || updatedAt === 0n || updatedAt > blockTimestamp) {
          throw new Error('Invalid price feed round');
        }
        priceUsdE8 = answer * BigInt(100_000_000) / BigInt(10) ** BigInt(feedDecimals);
        if (priceUsdE8 <= 0n) throw new Error('Price rounds to zero');
      } catch {
        issues.push(`PRICE_FEED_READ_UNAVAILABLE:${assetAddress}`);
      }
    }
    if (priceUsdE8 === null && isAaveReserve && oracle) {
      try {
        const rawPrice = await client.readContract({
          address: oracle.address,
          abi: AAVE_ORACLE_ABI,
          functionName: 'getAssetPrice',
          args: [assetAddress],
          blockNumber,
        });
        if (rawPrice > 0n) priceUsdE8 = (rawPrice * 100_000_000n) / oracle.baseUnit;
      } catch {
        // The null value below is authoritative; the issue explains why valuation is incomplete.
      }
    }
    if (priceUsdE8 === null && ((liquid ?? 0n) > 0n || (supplied ?? 0n) > 0n || (debt ?? 0n) > 0n)) {
      issues.push(`PRICE_UNAVAILABLE:${assetAddress}`);
    }

    return { address: assetAddress, symbol, decimals, decimalsKnown, liquid, supplied, debt, priceUsdE8, configured };
  }

  private async readOptionalBalance(
    client: PositionClient,
    tokenAddress: Address,
    basketAddress: Address,
    blockNumber: bigint,
  ): Promise<bigint> {
    if (tokenAddress.toLowerCase() === ZERO_ADDRESS) return 0n;
    return client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [basketAddress],
      blockNumber,
    });
  }
}
