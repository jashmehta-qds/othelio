import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  addressSchema,
  BasketCapabilities,
  chainIdSchema,
  createPortfolioOnlyCapabilities,
  PositionSnapshot,
  positionSnapshotSchema,
} from '@othelio/shared';
import { createPublicClient, http, parseAbi } from 'viem';
import { DatabaseService } from '../database/database.service';
import { AAVE_RPC_URLS, AAVE_V3_POOLS } from '../lending/adapters/aave-v3.adapter';
import { getLocalAssetMarket } from '../dex/local-anvil-market';

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

@Injectable()
export class BasketPositionService {
  constructor(
    @Inject(DatabaseService)
    private readonly db: DatabaseService,
  ) {}

  protected getClient(chainId: number): PositionClient | null {
    const rpcUrl = AAVE_RPC_URLS[chainId];
    return rpcUrl ? createPublicClient({ transport: http(rpcUrl) }) : null;
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
    const client = this.getClient(chainId);

    if (!client) {
      return {
        data: this.unavailableSnapshot(chainId, basketAddress, `RPC_UNCONFIGURED:${chainId}`),
        capabilities: this.getCapabilities(chainId),
      };
    }

    let block: Awaited<ReturnType<PositionClient['getBlock']>>;
    try {
      block = await client.getBlock({ blockTag: 'latest' });
    } catch {
      return {
        data: this.unavailableSnapshot(chainId, basketAddress, 'RPC_BLOCK_UNAVAILABLE'),
        capabilities: this.getCapabilities(chainId),
      };
    }

    const blockNumber = block.number;
    const blockHash = block.hash;
    if (blockNumber === null || blockHash === null) {
      return {
        data: this.unavailableSnapshot(chainId, basketAddress, 'RPC_BLOCK_NOT_CANONICAL'),
        capabilities: this.getCapabilities(chainId),
      };
    }

    const basketCode = await client.getBytecode({ address: basketAddress, blockNumber }).catch(() => undefined);
    if (!basketCode || basketCode === '0x') {
      throw new ConflictException(
        'BASKET_NOT_DEPLOYED_ON_CHAIN: the indexed basket does not exist on the current RPC chain. Recreate it after resetting or redeploying Anvil.',
      );
    }

    const issues: string[] = [];
    const configuredAssets = await this.getConfiguredAssets(chainId, basketAddress, blockNumber, issues);
    const additionalAssets = additionalAssetInputs.map((asset) => {
      try {
        return addressSchema.parse(asset).toLowerCase() as Address;
      } catch {
        throw new BadRequestException('Every additional asset must be a valid EVM address.');
      }
    });
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
        blockNumber,
        issues,
      )),
    );

    const additionalKeys = new Set(additionalAssets.map((address) => address.toLowerCase()));
    const visibleReads = reads.filter((read) =>
      read.configured || read.liquid === null || read.supplied === null || read.debt === null ||
      read.liquid > 0n || read.supplied > 0n || read.debt > 0n || additionalKeys.has(read.address.toLowerCase()),
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
    blockNumber: bigint,
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
    if (chainId === 31337) {
      priceUsdE8 = getLocalAssetMarket(assetAddress)?.priceUsdE8 ?? null;
    }
    if (isAaveReserve && oracle) {
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
