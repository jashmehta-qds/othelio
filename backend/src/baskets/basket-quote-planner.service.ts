import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  addressSchema,
  chainIdSchema,
  executionPlanSchema,
  PositionSnapshot,
} from '@othelio/shared';
import { createPublicClient, encodeFunctionData, http, parseAbi } from 'viem';
import { DexManagerService } from '../dex/dex-manager.service';
import { SwapQuoteResult } from '../dex/interfaces/dex-adapter.interface';
import { BasketPositionService } from './basket-position.service';

const MODULE_CAPABILITY_ABI = parseAbi([
  'function moduleVersion() external view returns (uint256)',
  'function supportsBoundedExecution() external view returns (bool)',
]);
const BASKET_MODULE_V3_ABI = parseAbi([
  'function rebalance((address safe,(address target,address allowanceSpender,address soldAsset,uint256 maxSoldAmount,bytes dexCalldata)[] legs,address[] soldAssets,uint256[] maxSoldAmounts,address[] boughtAssets,uint256[] minBoughtAmounts,address[] basketTokens,uint256 deadline) p) external returns (uint256[] soldAmounts,uint256[] boughtAmounts,uint256 totalNAV)',
]);
const BASKET_FUND_MODULE_V3_ABI = parseAbi([
  'function fundWithSwaps((address safe,address inputAsset,uint256 inputAmount,(address target,address allowanceSpender,uint256 inputAmount,bytes dexCalldata)[] legs,address[] boughtAssets,uint256[] minBoughtAmounts,address[] basketTokens,uint256 deadline) p) external returns (uint256[] boughtAmounts,uint256 totalNAV)',
]);
const BASKET_WITHDRAW_IN_KIND_V3_ABI = parseAbi([
  'function withdrawInKind(address safe,address recipient,address[] tokens,uint256[] amounts,address[] remainingTokens) external returns (uint256 remainingNAV)',
]);
const FACTORY_CREATE_SEED_V3_ABI = parseAbi([
  'function predictBasketAddress(address owner,bytes32 clientSalt) external view returns (address)',
  'function module() external view returns (address)',
  'function createAndSeedBasket(string name,(bytes32 clientSalt,(address safe,address inputAsset,uint256 inputAmount,(address target,address allowanceSpender,uint256 inputAmount,bytes dexCalldata)[] legs,address[] boughtAssets,uint256[] minBoughtAmounts,address[] basketTokens,uint256 deadline) mint) p) external returns (address basket,uint256[] boughtAmounts,uint256 totalNAV)',
]);
const RPC_URLS: Record<number, string | undefined> = {
  1: process.env.ETHEREUM_RPC_URL,
  31337: process.env.ANVIL_RPC_URL || process.env.RPC_URL || 'http://127.0.0.1:8545',
  8453: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  84532: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
};
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

type Address = `0x${string}`;

export interface BasketTargetWeight {
  assetAddress?: string;
  address?: string;
  symbol?: string;
  targetWeightBps: number;
}

export interface BasketQuoteRequest {
  action?: 'mint' | 'rebalance' | 'withdraw';
  chainId?: number;
  moduleAddress?: string;
  callerAddress?: string;
  inputAsset?: string;
  inputAmount?: string;
  slippageBps?: number;
  recipientAddress?: string;
  withdrawValueUsdE8?: string;
  targetWeights?: BasketTargetWeight[];
  /** Transitional alias used by the existing funding UI. */
  holdings?: BasketTargetWeight[];
}

export interface CreateSeedQuoteRequest {
  chainId: number;
  factoryAddress: string;
  moduleAddress: string;
  ownerAddress: string;
  name: string;
  clientSalt: `0x${string}`;
  inputAsset: string;
  inputAmount: string;
  slippageBps?: number;
  targetWeights: BasketTargetWeight[];
}

interface NetTrade {
  assetAddress: Address;
  amountBaseUnits: bigint;
  valueUsdE8: bigint;
}

@Injectable()
export class BasketQuotePlannerService {
  constructor(
    @Inject(DexManagerService)
    private readonly dexManagerService: DexManagerService,
    @Inject(BasketPositionService)
    private readonly positions: BasketPositionService,
  ) {}

  async quoteSwaps(basketAddressInput: string, body: BasketQuoteRequest) {
    const basketAddress = this.parseAddress(basketAddressInput, 'basketAddress');
    const action = body.action ?? 'mint';
    if (action === 'rebalance') return this.quoteRebalance(basketAddress, body);
    if (action === 'mint') return this.quoteSingleAssetFunding(basketAddress, body);
    return this.quoteInKindWithdrawal(basketAddress, body);
  }

  private async quoteInKindWithdrawal(basketAddress: Address, body: BasketQuoteRequest) {
    const chainId = this.requireChainId(body.chainId);
    const moduleAddress = this.parseAddress(body.moduleAddress, 'moduleAddress');
    const callerAddress = this.parseAddress(body.callerAddress, 'callerAddress');
    const recipientAddress = this.parseAddress(body.recipientAddress ?? body.callerAddress, 'recipientAddress');
    const requestedValueUsdE8 = this.parsePositiveAmount(body.withdrawValueUsdE8, 'withdrawValueUsdE8');
    const { data: snapshot, capabilities } = await this.positions.getPositionSnapshot(basketAddress, chainId);
    const capability = capabilities.actions.WITHDRAW_LIQUID;
    if (capability.availability === 'DISABLED') throw new UnprocessableEntityException(capability.reason);
    this.assertUsableSnapshot(snapshot, basketAddress, chainId);

    let totalLiquidValueUsdE8 = 0n;
    const positions = snapshot.tokens.map((token) => {
      if (token.liquidAmountBaseUnits === null || token.priceUsdE8 === null) {
        throw new UnprocessableEntityException(`Liquid balance or price is unknown for ${token.assetAddress}.`);
      }
      const balance = BigInt(token.liquidAmountBaseUnits);
      const valueUsdE8 = (balance * BigInt(token.priceUsdE8)) / (10n ** BigInt(token.decimals));
      totalLiquidValueUsdE8 += valueUsdE8;
      return { assetAddress: token.assetAddress as Address, balance };
    });
    if (totalLiquidValueUsdE8 <= 0n) throw new UnprocessableEntityException('The basket has no valued liquid assets to withdraw.');
    if (requestedValueUsdE8 > totalLiquidValueUsdE8) {
      throw new UnprocessableEntityException('The requested withdrawal exceeds the canonical liquid basket value.');
    }

    const withdrawals = positions.map((position) => ({
      ...position,
      amount: requestedValueUsdE8 === totalLiquidValueUsdE8
        ? position.balance
        : (position.balance * requestedValueUsdE8) / totalLiquidValueUsdE8,
    })).filter((position) => position.amount > 0n);
    if (withdrawals.length === 0) throw new UnprocessableEntityException('The requested value is too small to produce a token withdrawal.');

    const tokens = withdrawals.map((position) => position.assetAddress);
    const amounts = withdrawals.map((position) => position.amount);
    const remainingTokens = positions.map((position) => position.assetAddress);
    const moduleCalldata = encodeFunctionData({
      abi: BASKET_WITHDRAW_IN_KIND_V3_ABI,
      functionName: 'withdrawInKind',
      args: [basketAddress, recipientAddress, tokens, amounts, remainingTokens],
    });
    const simulation = await this.verifyV3AndSimulate({ chainId, snapshot, moduleAddress, callerAddress, moduleCalldata });
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    const plan = executionPlanSchema.parse({
      action: 'WITHDRAW_LIQUID',
      accountAddress: basketAddress,
      chainId,
      snapshot: { chainId, basketAddress, blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash },
      calls: [{ order: 0, to: moduleAddress, calldata: moduleCalldata, valueBaseUnits: '0' }],
      approvals: [],
      limits: withdrawals.map((position) => ({ assetAddress: position.assetAddress, maxInputBaseUnits: position.amount.toString(), minOutputBaseUnits: null })),
      expiresAt,
      expectedAfterState: withdrawals.map((position) => ({ assetAddress: position.assetAddress, liquidDeltaBaseUnits: `-${position.amount}` })),
      simulation,
    });
    return {
      success: true,
      executionAllowed: true,
      data: {
        basketAddress,
        action: 'withdraw',
        chainId,
        recipientAddress,
        withdrawValueUsdE8: requestedValueUsdE8.toString(),
        plan,
        module: { address: moduleAddress, moduleVersion: 3, supportsBoundedExecution: true },
        withdrawal: { tokens, amounts: amounts.map(String), remainingTokens },
      },
    };
  }

  async quoteCreateSeed(body: CreateSeedQuoteRequest) {
    const chainId = this.requireChainId(body.chainId);
    const factoryAddress = this.parseAddress(body.factoryAddress, 'factoryAddress');
    const moduleAddress = this.parseAddress(body.moduleAddress, 'moduleAddress');
    const ownerAddress = this.parseAddress(body.ownerAddress, 'ownerAddress');
    const inputAsset = this.parseAddress(body.inputAsset, 'inputAsset');
    const inputAmount = this.parsePositiveAmount(body.inputAmount, 'inputAmount');
    if (!body.name.trim() || body.name.length > 128) throw new BadRequestException('name must contain 1 through 128 characters.');
    if (!/^0x[\da-fA-F]{64}$/.test(body.clientSalt)) throw new BadRequestException('clientSalt must be a 32-byte hex value.');
    const targets = this.parseTargetWeights(body.targetWeights).filter((target) => target.targetWeightBps > 0)
      .sort((a, b) => this.parseAddress(a.assetAddress ?? a.address, 'target assetAddress').localeCompare(this.parseAddress(b.assetAddress ?? b.address, 'target assetAddress')));
    if (targets.length === 0) throw new BadRequestException('At least one positive target is required.');
    const rpcUrl = RPC_URLS[chainId];
    if (!rpcUrl) throw new ServiceUnavailableException(`No RPC is configured for chain ${chainId}.`);
    const client = createPublicClient({ transport: http(rpcUrl) });
    const [predictedBasketAddress, configuredModule, moduleVersion, bounded, boundFactory] = await Promise.all([
      client.readContract({ address: factoryAddress, abi: FACTORY_CREATE_SEED_V3_ABI, functionName: 'predictBasketAddress', args: [ownerAddress, body.clientSalt] }),
      client.readContract({ address: factoryAddress, abi: FACTORY_CREATE_SEED_V3_ABI, functionName: 'module' }),
      client.readContract({ address: moduleAddress, abi: MODULE_CAPABILITY_ABI, functionName: 'moduleVersion' }),
      client.readContract({ address: moduleAddress, abi: MODULE_CAPABILITY_ABI, functionName: 'supportsBoundedExecution' }),
      client.readContract({ address: moduleAddress, abi: parseAbi(['function factory() view returns (address)']), functionName: 'factory' }),
    ]).catch(() => { throw new UnprocessableEntityException('CREATE_SEED_CAPABILITY_UNAVAILABLE'); });
    if (configuredModule.toLowerCase() !== moduleAddress || moduleVersion !== 3n || !bounded || boundFactory.toLowerCase() !== factoryAddress) {
      throw new UnprocessableEntityException('CREATE_SEED_CAPABILITY_MISMATCH');
    }
    const legs: Array<{ target: Address; allowanceSpender: Address; inputAmount: bigint; dexCalldata: `0x${string}` }> = [];
    const boughtAssets: Address[] = [];
    const minBoughtAmounts: bigint[] = [];
    const trades: any[] = [];
    let spent = 0n;
    let expiry: string | null = null;
    for (let i = 0; i < targets.length; i++) {
      const buyAsset = this.parseAddress(targets[i].assetAddress ?? targets[i].address, 'target assetAddress');
      if (buyAsset === inputAsset) throw new UnprocessableEntityException('CREATE_SEED_INPUT_TARGET_UNSUPPORTED');
      const amount = i === targets.length - 1 ? inputAmount - spent : (inputAmount * BigInt(targets[i].targetWeightBps)) / 10_000n;
      spent += amount;
      const { winningQuote: route } = await this.dexManagerService.getBestQuote({ chainId, sellToken: inputAsset, buyToken: buyAsset, sellAmount: amount.toString(), takerAddress: predictedBasketAddress, slippageBps: this.parseSlippage(body.slippageBps) });
      this.assertBoundRoute(route, chainId, predictedBasketAddress, { assetAddress: inputAsset, amountBaseUnits: amount, valueUsdE8: 0n }, { assetAddress: buyAsset, amountBaseUnits: 0n, valueUsdE8: 0n });
      if (new Date(route.expiresAt).getTime() <= Date.now()) throw new ServiceUnavailableException('The DEX route expired before create-and-seed could be prepared.');
      if (!expiry || new Date(route.expiresAt).getTime() < new Date(expiry).getTime()) expiry = route.expiresAt;
      legs.push({ target: route.routerAddress as Address, allowanceSpender: route.allowanceSpender as Address, inputAmount: amount, dexCalldata: route.dexCalldata as `0x${string}` });
      boughtAssets.push(buyAsset); minBoughtAmounts.push(route.minBuyAmount);
      trades.push({ sellAsset: inputAsset, buyAsset, amountIn: amount.toString(), expectedOut: route.expectedBuyAmount.toString(), minOut: route.minBuyAmount.toString(), target: route.routerAddress, allowanceSpender: route.allowanceSpender, expiresAt: route.expiresAt });
    }
    const deadline = Math.floor(new Date(expiry!).getTime() / 1000);
    const calldata = encodeFunctionData({ abi: FACTORY_CREATE_SEED_V3_ABI, functionName: 'createAndSeedBasket', args: [body.name, { clientSalt: body.clientSalt, mint: { safe: predictedBasketAddress, inputAsset, inputAmount, legs, boughtAssets, minBoughtAmounts, basketTokens: boughtAssets, deadline: BigInt(deadline) } }] });
    try { await client.call({ account: ownerAddress, to: factoryAddress, data: calldata }); } catch (error) { throw new UnprocessableEntityException(`CREATE_SEED_SIMULATION_FAILED: ${error instanceof Error ? error.message : 'exact factory call reverted'}`); }
    const plan = executionPlanSchema.parse({ action: 'FUND', accountAddress: predictedBasketAddress, chainId, snapshot: { chainId, basketAddress: predictedBasketAddress, blockNumber: 0, blockHash: `0x${'0'.repeat(64)}` }, calls: [{ order: 0, to: factoryAddress, calldata, valueBaseUnits: '0' }], approvals: [{ tokenAddress: inputAsset, spenderAddress: moduleAddress, maxAmountBaseUnits: inputAmount.toString() }], limits: [{ assetAddress: inputAsset, maxInputBaseUnits: inputAmount.toString(), minOutputBaseUnits: null }, ...boughtAssets.map((assetAddress, i) => ({ assetAddress, maxInputBaseUnits: null, minOutputBaseUnits: minBoughtAmounts[i].toString() }))], expiresAt: expiry, expectedAfterState: [], simulation: { status: 'SUCCEEDED', reason: null, simulatedAt: new Date().toISOString(), blockNumber: null } });
    return { success: true, executionAllowed: true, data: { plan, predictedBasketAddress, factory: { address: factoryAddress, moduleAddress }, module: { address: moduleAddress, moduleVersion: 3, supportsBoundedExecution: true }, deadline: deadline.toString(), trades } };
  }

  private async quoteRebalance(basketAddress: Address, body: BasketQuoteRequest) {
    const chainId = this.requireChainId(body.chainId);
    const moduleAddress = this.parseAddress(body.moduleAddress, 'moduleAddress');
    const callerAddress = this.parseAddress(body.callerAddress, 'callerAddress');
    const slippageBps = this.parseSlippage(body.slippageBps);
    const targetWeights = this.parseTargetWeights(body.targetWeights ?? body.holdings);
    const targetAssets = targetWeights.map((target) => this.parseAddress(target.assetAddress ?? target.address, 'target assetAddress'));
    const { data: snapshot, capabilities } = await this.positions.getPositionSnapshot(basketAddress, chainId, targetAssets);
    const spotCapability = capabilities.actions.SPOT_REBALANCE;
    if (spotCapability.availability === 'DISABLED') {
      throw new UnprocessableEntityException(spotCapability.reason);
    }
    this.assertUsableSnapshot(snapshot, basketAddress, chainId);

    const { sells, buys, basketTokens } = this.computeNetTrades(snapshot, targetWeights);
    if (sells.length === 0 && buys.length === 0) {
      throw new UnprocessableEntityException('The requested targets produce no executable rebalance trade.');
    }

    const legs: Array<{ target: Address; allowanceSpender: Address; soldAsset: Address; maxSoldAmount: bigint; dexCalldata: `0x${string}` }> = [];
    const soldAssets: Address[] = sells.map((s) => s.assetAddress);
    const maxSoldAmounts: bigint[] = sells.map((s) => s.amountBaseUnits);
    const boughtAssets: Address[] = buys.map((b) => b.assetAddress);
    const minBoughtAmounts: bigint[] = [];
    const trades: any[] = [];
    const approvalsMap = new Map<string, { tokenAddress: Address; spenderAddress: Address; maxAmountBaseUnits: bigint }>();
    const limits: Array<{ assetAddress: Address; maxInputBaseUnits: string | null; minOutputBaseUnits: string | null }> = [];
    const expectedAfterState: Array<{ assetAddress: Address; liquidDeltaBaseUnits: string }> = [];

    for (const sell of sells) {
      limits.push({ assetAddress: sell.assetAddress, maxInputBaseUnits: sell.amountBaseUnits.toString(), minOutputBaseUnits: null });
      expectedAfterState.push({ assetAddress: sell.assetAddress, liquidDeltaBaseUnits: `-${sell.amountBaseUnits}` });
    }

    let earliestExpiry: string | null = null;

    if (sells.length === 1 && buys.length >= 1) {
      const sell = sells[0];
      const totalBuyValueUsdE8 = buys.reduce((sum, b) => sum + b.valueUsdE8, 0n);
      let accumulatedSellAmount = 0n;

      for (let i = 0; i < buys.length; i++) {
        const buy = buys[i];
        const legSellAmount = (i === buys.length - 1)
          ? sell.amountBaseUnits - accumulatedSellAmount
          : (totalBuyValueUsdE8 > 0n)
            ? (sell.amountBaseUnits * buy.valueUsdE8) / totalBuyValueUsdE8
            : sell.amountBaseUnits / BigInt(buys.length);

        accumulatedSellAmount += legSellAmount;

        if (legSellAmount <= 0n) {
          minBoughtAmounts.push(0n);
          continue;
        }

        const { winningQuote: route } = await this.dexManagerService.getBestQuote({
          chainId,
          sellToken: sell.assetAddress,
          buyToken: buy.assetAddress,
          sellAmount: legSellAmount.toString(),
          takerAddress: basketAddress,
          slippageBps,
        });

        this.assertBoundRoute(route, chainId, basketAddress, { ...sell, amountBaseUnits: legSellAmount }, buy);

        if (new Date(route.expiresAt).getTime() <= Date.now()) {
          throw new ServiceUnavailableException('The DEX route expired before it could be prepared.');
        }
        if (!earliestExpiry || new Date(route.expiresAt).getTime() < new Date(earliestExpiry).getTime()) {
          earliestExpiry = route.expiresAt;
        }

        legs.push({
          target: route.routerAddress as Address,
          allowanceSpender: route.allowanceSpender as Address,
          soldAsset: sell.assetAddress,
          maxSoldAmount: legSellAmount,
          dexCalldata: route.dexCalldata as `0x${string}`,
        });

        minBoughtAmounts.push(route.minBuyAmount);
        limits.push({ assetAddress: buy.assetAddress, maxInputBaseUnits: null, minOutputBaseUnits: route.minBuyAmount.toString() });
        expectedAfterState.push({ assetAddress: buy.assetAddress, liquidDeltaBaseUnits: route.expectedBuyAmount.toString() });

        const appKey = `${sell.assetAddress.toLowerCase()}:${route.allowanceSpender.toLowerCase()}`;
        const existingApp = approvalsMap.get(appKey);
        if (existingApp) {
          existingApp.maxAmountBaseUnits += legSellAmount;
        } else {
          approvalsMap.set(appKey, {
            tokenAddress: sell.assetAddress,
            spenderAddress: route.allowanceSpender as Address,
            maxAmountBaseUnits: legSellAmount,
          });
        }

        trades.push({
          sellAsset: sell.assetAddress,
          buyAsset: buy.assetAddress,
          amountIn: legSellAmount.toString(),
          expectedOut: route.expectedBuyAmount.toString(),
          minOut: route.minBuyAmount.toString(),
          provider: route.providerName,
          estimatedGasUsd: route.estimatedGasUsd,
          calldata: route.dexCalldata,
          target: route.routerAddress,
          allowanceSpender: route.allowanceSpender,
          expiresAt: route.expiresAt,
        });
      }
    } else {
      const buyMinAmountSums = buys.map(() => 0n);
      const buyExpectedAmountSums = buys.map(() => 0n);
      const totalBuyValueUsdE8 = buys.reduce((sum, buy) => sum + buy.valueUsdE8, 0n);

      // Spread each sell across all purchases.  Each sell's final leg receives the rounding
      // remainder so the route caps sum exactly to its declared aggregate maximum.
      for (const sell of sells) {
        let allocatedSellAmount = 0n;
        for (let buyIndex = 0; buyIndex < buys.length; buyIndex++) {
          const buy = buys[buyIndex];
          const legSellAmount = buyIndex === buys.length - 1
            ? sell.amountBaseUnits - allocatedSellAmount
            : totalBuyValueUsdE8 > 0n
              ? (sell.amountBaseUnits * buy.valueUsdE8) / totalBuyValueUsdE8
              : sell.amountBaseUnits / BigInt(buys.length);
          allocatedSellAmount += legSellAmount;
          if (legSellAmount === 0n) continue;

          const { winningQuote: route } = await this.dexManagerService.getBestQuote({
            chainId,
            sellToken: sell.assetAddress,
            buyToken: buy.assetAddress,
            sellAmount: legSellAmount.toString(),
            takerAddress: basketAddress,
            slippageBps,
          });

          this.assertBoundRoute(route, chainId, basketAddress, { ...sell, amountBaseUnits: legSellAmount }, buy);

          if (new Date(route.expiresAt).getTime() <= Date.now()) {
            throw new ServiceUnavailableException('The DEX route expired before it could be prepared.');
          }
          if (!earliestExpiry || new Date(route.expiresAt).getTime() < new Date(earliestExpiry).getTime()) {
            earliestExpiry = route.expiresAt;
          }

          legs.push({
            target: route.routerAddress as Address,
            allowanceSpender: route.allowanceSpender as Address,
            soldAsset: sell.assetAddress,
            maxSoldAmount: legSellAmount,
            dexCalldata: route.dexCalldata as `0x${string}`,
          });

          buyMinAmountSums[buyIndex] += route.minBuyAmount;
          buyExpectedAmountSums[buyIndex] += route.expectedBuyAmount;

          const appKey = `${sell.assetAddress.toLowerCase()}:${route.allowanceSpender.toLowerCase()}`;
          const existingApp = approvalsMap.get(appKey);
          if (existingApp) {
            existingApp.maxAmountBaseUnits += legSellAmount;
          } else {
            approvalsMap.set(appKey, {
              tokenAddress: sell.assetAddress,
              spenderAddress: route.allowanceSpender as Address,
              maxAmountBaseUnits: legSellAmount,
            });
          }

          trades.push({
            sellAsset: sell.assetAddress,
            buyAsset: buy.assetAddress,
            amountIn: legSellAmount.toString(),
            expectedOut: route.expectedBuyAmount.toString(),
            minOut: route.minBuyAmount.toString(),
            provider: route.providerName,
            estimatedGasUsd: route.estimatedGasUsd,
            calldata: route.dexCalldata,
            target: route.routerAddress,
            allowanceSpender: route.allowanceSpender,
            expiresAt: route.expiresAt,
          });
        }
      }

      for (let buyIndex = 0; buyIndex < buys.length; buyIndex++) {
        const buy = buys[buyIndex];
        minBoughtAmounts.push(buyMinAmountSums[buyIndex]);
        limits.push({ assetAddress: buy.assetAddress, maxInputBaseUnits: null, minOutputBaseUnits: buyMinAmountSums[buyIndex].toString() });
        expectedAfterState.push({ assetAddress: buy.assetAddress, liquidDeltaBaseUnits: buyExpectedAmountSums[buyIndex].toString() });
      }
    }

    const routeExpiry = earliestExpiry ?? new Date(Date.now() + 300_000).toISOString();
    const deadline = Math.floor(new Date(routeExpiry).getTime() / 1_000);
    if (!Number.isSafeInteger(deadline) || deadline <= Math.floor(Date.now() / 1_000)) {
      throw new ServiceUnavailableException('The DEX route expired before it could be prepared.');
    }

    const moduleCalldata = encodeFunctionData({
      abi: BASKET_MODULE_V3_ABI,
      functionName: 'rebalance',
      args: [{
        safe: basketAddress,
        legs,
        soldAssets,
        maxSoldAmounts,
        boughtAssets,
        minBoughtAmounts,
        basketTokens,
        deadline: BigInt(deadline),
      }],
    });

    const simulation = await this.verifyV2AndSimulate({
      chainId,
      snapshot,
      moduleAddress,
      callerAddress,
      moduleCalldata,
    });

    const approvals = Array.from(approvalsMap.values()).map((a) => ({
      tokenAddress: a.tokenAddress,
      spenderAddress: a.spenderAddress,
      maxAmountBaseUnits: a.maxAmountBaseUnits.toString(),
    }));

    const plan = executionPlanSchema.parse({
      action: 'SPOT_REBALANCE',
      accountAddress: basketAddress,
      chainId,
      snapshot: {
        chainId: snapshot.chainId,
        basketAddress: snapshot.basketAddress,
        blockNumber: snapshot.blockNumber,
        blockHash: snapshot.blockHash,
      },
      calls: [{ order: 0, to: moduleAddress, calldata: moduleCalldata, valueBaseUnits: '0' }],
      approvals,
      limits,
      expiresAt: routeExpiry,
      expectedAfterState,
      simulation,
    });

    const primaryRoute = trades[0];

    return {
      success: true,
      executionAllowed: plan.simulation.status === 'SUCCEEDED',
      data: {
        plan,
        module: { address: moduleAddress, moduleVersion: 3, supportsBoundedExecution: true },
        route: {
          provider: primaryRoute.provider,
          target: primaryRoute.target,
          calldata: primaryRoute.calldata,
          allowanceSpender: primaryRoute.allowanceSpender,
          recipient: basketAddress,
          sellAsset: primaryRoute.sellAsset,
          buyAsset: primaryRoute.buyAsset,
          maxSellAmount: primaryRoute.amountIn,
          minBuyAmount: primaryRoute.minOut,
          expectedBuyAmount: primaryRoute.expectedOut,
          expiresAt: primaryRoute.expiresAt,
        },
        rebalance: {
          soldAssets,
          maxSoldAmounts: maxSoldAmounts.map((m) => m.toString()),
          boughtAssets,
          minBoughtAmounts: minBoughtAmounts.map((m) => m.toString()),
          basketTokens,
          deadline: deadline.toString(),
        },
        trades,
      },
    };
  }

  private async quoteSingleAssetFunding(basketAddress: Address, body: BasketQuoteRequest) {
    const chainId = this.requireChainId(body.chainId ?? Number(process.env.CHAIN_ID || 31337));
    const inputAsset = this.parseAddress(body.inputAsset ?? BASE_USDC, 'inputAsset');
    const inputAmount = this.parsePositiveAmount(body.inputAmount, 'inputAmount');
    const moduleAddress = this.parseAddress(body.moduleAddress, 'moduleAddress');
    const callerAddress = this.parseAddress(body.callerAddress, 'callerAddress');
    const slippageBps = this.parseSlippage(body.slippageBps);
    const targets = this.parseTargetWeights(body.targetWeights ?? body.holdings).filter((target) => target.targetWeightBps > 0);
    if (targets.length === 0) {
      throw new UnprocessableEntityException('No valid targets with targetWeightBps > 0 were specified for funding.');
    }

    const { data: snapshot, capabilities } = await this.positions.getPositionSnapshot(basketAddress, chainId);
    if (capabilities.actions.FUND.availability === 'DISABLED') {
      throw new UnprocessableEntityException(capabilities.actions.FUND.reason);
    }
    if (snapshot.blockNumber === 0 || snapshot.blockHash === `0x${'0'.repeat(64)}`) {
      throw new ServiceUnavailableException('A canonical basket block is required before direct funding can be simulated.');
    }

    const totalWeightBps = targets.reduce((sum, t) => sum + t.targetWeightBps, 0);
    const legs: Array<{ target: Address; allowanceSpender: Address; inputAmount: bigint; dexCalldata: `0x${string}` }> = [];
    const boughtAssets: Address[] = [];
    const minBoughtAmounts: bigint[] = [];
    const basketTokensSet = new Set<Address>();
    const trades: any[] = [];
    const expectedAfterState: Array<{ assetAddress: Address; liquidDeltaBaseUnits: string }> = [];
    const limits: Array<{ assetAddress: Address; maxInputBaseUnits: string | null; minOutputBaseUnits: string | null }> = [
      { assetAddress: inputAsset, maxInputBaseUnits: inputAmount.toString(), minOutputBaseUnits: null },
    ];

    let earliestExpiry: string = new Date(Date.now() + 300_000).toISOString();
    let accumulatedLegInput = 0n;

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const buyAsset = this.parseAddress(target.assetAddress ?? target.address, 'target assetAddress');
      basketTokensSet.add(buyAsset);
      boughtAssets.push(buyAsset);

      const legInputAmount = (i === targets.length - 1)
        ? inputAmount - accumulatedLegInput
        : (inputAmount * BigInt(target.targetWeightBps)) / BigInt(totalWeightBps);

      accumulatedLegInput += legInputAmount;

      if (legInputAmount <= 0n) {
        minBoughtAmounts.push(0n);
        continue;
      }

      if (inputAsset.toLowerCase() === buyAsset.toLowerCase()) {
        minBoughtAmounts.push(legInputAmount);
        limits.push({ assetAddress: buyAsset, maxInputBaseUnits: null, minOutputBaseUnits: legInputAmount.toString() });
        expectedAfterState.push({ assetAddress: buyAsset, liquidDeltaBaseUnits: legInputAmount.toString() });
        continue;
      }

      const { winningQuote: route } = await this.dexManagerService.getBestQuote({
        chainId,
        sellToken: inputAsset,
        buyToken: buyAsset,
        sellAmount: legInputAmount.toString(),
        takerAddress: basketAddress,
        slippageBps,
      });

      this.assertBoundRoute(
        route,
        chainId,
        basketAddress,
        { assetAddress: inputAsset, amountBaseUnits: legInputAmount, valueUsdE8: 0n },
        { assetAddress: buyAsset, amountBaseUnits: 0n, valueUsdE8: 0n },
      );

      if (new Date(route.expiresAt).getTime() <= Date.now()) {
        throw new ServiceUnavailableException('The DEX route expired before direct funding could be prepared.');
      }

      if (new Date(route.expiresAt).getTime() < new Date(earliestExpiry).getTime()) {
        earliestExpiry = route.expiresAt;
      }

      legs.push({
        target: route.routerAddress as Address,
        allowanceSpender: route.allowanceSpender as Address,
        inputAmount: legInputAmount,
        dexCalldata: route.dexCalldata as `0x${string}`,
      });

      minBoughtAmounts.push(route.minBuyAmount);
      limits.push({ assetAddress: buyAsset, maxInputBaseUnits: null, minOutputBaseUnits: route.minBuyAmount.toString() });
      expectedAfterState.push({ assetAddress: buyAsset, liquidDeltaBaseUnits: route.expectedBuyAmount.toString() });

      trades.push({
        assetAddress: buyAsset,
        amountIn: legInputAmount.toString(),
        expectedOut: route.expectedBuyAmount.toString(),
        minOut: route.minBuyAmount.toString(),
        provider: route.providerName,
        estimatedGasUsd: route.estimatedGasUsd,
        calldata: route.dexCalldata,
        target: route.routerAddress,
        allowanceSpender: route.allowanceSpender,
        recipient: route.recipientAddress,
        expiresAt: route.expiresAt,
      });
    }

    const basketTokens = Array.from(basketTokensSet);

    const moduleCalldata = encodeFunctionData({
      abi: BASKET_FUND_MODULE_V3_ABI,
      functionName: 'fundWithSwaps',
      args: [{
        safe: basketAddress,
        inputAsset,
        inputAmount,
        legs,
        boughtAssets,
        minBoughtAmounts,
        basketTokens,
        deadline: BigInt(Math.floor(new Date(earliestExpiry).getTime() / 1_000)),
      }],
    });

    const simulation = await this.verifyV3AndSimulate({
      chainId,
      snapshot,
      moduleAddress,
      callerAddress,
      moduleCalldata,
    });

    const plan = executionPlanSchema.parse({
      action: 'FUND',
      accountAddress: basketAddress,
      chainId,
      snapshot: { chainId: snapshot.chainId, basketAddress: snapshot.basketAddress, blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash },
      calls: [{ order: 0, to: moduleAddress, calldata: moduleCalldata, valueBaseUnits: '0' }],
      approvals: [{
        tokenAddress: inputAsset,
        spenderAddress: moduleAddress,
        maxAmountBaseUnits: inputAmount.toString(),
      }],
      limits,
      expiresAt: earliestExpiry,
      expectedAfterState,
      simulation,
    });

    const primaryTarget = legs[0]?.target ?? '0x0000000000000000000000000000000000000000';
    const primarySpender = legs[0]?.allowanceSpender ?? '0x0000000000000000000000000000000000000000';
    const primaryCalldata = legs[0]?.dexCalldata ?? '0x';

    return {
      success: true,
      executionAllowed: plan.simulation.status === 'SUCCEEDED',
      data: {
        basketAddress,
        action: 'mint',
        chainId,
        inputAsset,
        inputAmount: inputAmount.toString(),
        slippageBps,
        target: primaryTarget,
        allowanceSpender: primarySpender,
        dexCalldata: primaryCalldata,
        soldAssets: [inputAsset],
        boughtAssets,
        minBoughtAmounts: minBoughtAmounts.map((m) => m.toString()),
        basketTokens,
        plan,
        module: { address: moduleAddress, moduleVersion: 3, supportsBoundedExecution: true },
        trades,
        preparationReason: 'Direct post-create funding was simulated for the supplied owner/funder. Factory create-and-seed uses a distinct factory caller flow and is not prepared here.',
      },
    };
  }

  private computeNetTrades(snapshot: PositionSnapshot, targets: BasketTargetWeight[]) {
    const targetByAddress = new Map(targets.map((target) => [
      this.parseAddress(target.assetAddress ?? target.address, 'target assetAddress').toLowerCase(),
      target.targetWeightBps,
    ]));
    const snapshotByAddress = new Map<string, PositionSnapshot['tokens'][number]>();
    for (const token of snapshot.tokens) {
      const key = token.assetAddress.toLowerCase();
      if (snapshotByAddress.has(key)) {
        throw new UnprocessableEntityException(`Duplicate asset ${key} in the canonical snapshot.`);
      }
      snapshotByAddress.set(key, token);
    }
    for (const assetAddress of targetByAddress.keys()) {
      if (!snapshotByAddress.has(assetAddress)) {
        throw new UnprocessableEntityException(`Target asset ${assetAddress} is absent from the canonical snapshot.`);
      }
    }
    let totalLiquidValueUsdE8 = 0n;
    const currentValues = new Map<string, bigint>();
    for (const token of snapshot.tokens) {
      if (token.liquidAmountBaseUnits === null || token.priceUsdE8 === null) {
        throw new UnprocessableEntityException(`Liquid balance or price is unknown for ${token.assetAddress}.`);
      }
      const value = (BigInt(token.liquidAmountBaseUnits) * BigInt(token.priceUsdE8)) / (10n ** BigInt(token.decimals));
      currentValues.set(token.assetAddress.toLowerCase(), value);
      totalLiquidValueUsdE8 += value;
    }
    if (totalLiquidValueUsdE8 <= 0n) {
      throw new UnprocessableEntityException('The basket has no valued liquid assets to rebalance.');
    }
    const sells: NetTrade[] = [];
    const buys: NetTrade[] = [];
    for (const token of snapshot.tokens) {
      const key = token.assetAddress.toLowerCase();
      const currentValue = currentValues.get(key) ?? 0n;
      const targetValue = (totalLiquidValueUsdE8 * BigInt(targetByAddress.get(key) ?? 0)) / 10_000n;
      if (currentValue === targetValue) continue;
      const valueDelta = currentValue - targetValue;
      const priceUsdE8 = BigInt(token.priceUsdE8!);
      const amountBaseUnits = ((valueDelta < 0n ? -valueDelta : valueDelta) * (10n ** BigInt(token.decimals))) / priceUsdE8;
      if (amountBaseUnits === 0n) continue;
      (valueDelta > 0n ? sells : buys).push({
        assetAddress: token.assetAddress as Address,
        amountBaseUnits,
        valueUsdE8: valueDelta < 0n ? -valueDelta : valueDelta,
      });
    }
    return { sells, buys, basketTokens: snapshot.tokens.map((token) => token.assetAddress as Address) };
  }

  private assertUsableSnapshot(snapshot: PositionSnapshot, basketAddress: Address, chainId: number) {
    if (snapshot.chainId !== chainId || snapshot.basketAddress.toLowerCase() !== basketAddress.toLowerCase()) {
      throw new UnprocessableEntityException('The canonical snapshot does not match the requested basket and chain.');
    }
    if (snapshot.readCompleteness === 'UNAVAILABLE' || snapshot.valuationStatus === 'UNAVAILABLE' || snapshot.valuationStatus === 'STALE') {
      throw new UnprocessableEntityException('Current liquid balances and prices are required for every planned asset.');
    }
    if (snapshot.issues.some((issue) => issue.startsWith('AAVE_RESERVE_DISCOVERY_UNAVAILABLE'))) {
      throw new UnprocessableEntityException(
        'LENDING_POSITION_DISCOVERY_UNAVAILABLE: spot rebalance cannot proceed while the configured market position read is incomplete.',
      );
    }
    const hasMarketExposure = snapshot.markets.some((market) => (
      market.suppliedAmountBaseUnits === null
      || market.accruedDebtAmountBaseUnits === null
      || BigInt(market.suppliedAmountBaseUnits) > 0n
      || BigInt(market.accruedDebtAmountBaseUnits) > 0n
    ));
    if (hasMarketExposure) {
      throw new UnprocessableEntityException(
        'ENCUMBERED_POSITION_UNSUPPORTED: spot rebalance is limited to verified liquid positions; supplied assets or debt require a recovery-aware planner.',
      );
    }
  }

  private assertBoundRoute(route: SwapQuoteResult, chainId: number, recipient: Address, sell: NetTrade, buy: NetTrade) {
    const valid = route.isAvailable
      && route.chainId === chainId
      && route.sellToken.toLowerCase() === sell.assetAddress.toLowerCase()
      && route.buyToken.toLowerCase() === buy.assetAddress.toLowerCase()
      && route.sellAmount === sell.amountBaseUnits
      && route.recipientAddress.toLowerCase() === recipient.toLowerCase()
      && route.expectedBuyAmount > 0n
      && route.minBuyAmount > 0n
      && route.minBuyAmount <= route.expectedBuyAmount
      && route.dexCalldata !== '0x';
    if (!valid) throw new ServiceUnavailableException('The selected DEX route is incomplete or does not match the requested trade.');
    this.parseAddress(route.routerAddress, 'route target');
    this.parseAddress(route.allowanceSpender, 'route allowance spender');
    this.parseAddress(route.recipientAddress, 'route recipient');
  }

  private async verifyV2AndSimulate(input: {
    chainId: number;
    snapshot: PositionSnapshot;
    moduleAddress: Address;
    callerAddress: Address;
    moduleCalldata: `0x${string}`;
  }) {
    return this.verifyV3AndSimulate(input);
  }

  private async verifyV3AndSimulate(input: {
    chainId: number;
    snapshot?: PositionSnapshot;
    moduleAddress: Address;
    callerAddress: Address;
    moduleCalldata: `0x${string}`;
  }) {
    const rpcUrl = RPC_URLS[input.chainId];
    if (!rpcUrl) throw new ServiceUnavailableException(`No RPC is configured for chain ${input.chainId}.`);
    const client = createPublicClient({ transport: http(rpcUrl) });
    let moduleVersion: bigint;
    let supportsBoundedExecution: boolean;
    try {
      [moduleVersion, supportsBoundedExecution] = await Promise.all([
        client.readContract({ address: input.moduleAddress, abi: MODULE_CAPABILITY_ABI, functionName: 'moduleVersion', blockNumber: input.snapshot ? BigInt(input.snapshot.blockNumber) : undefined }),
        client.readContract({ address: input.moduleAddress, abi: MODULE_CAPABILITY_ABI, functionName: 'supportsBoundedExecution', blockNumber: input.snapshot ? BigInt(input.snapshot.blockNumber) : undefined }),
      ]);
    } catch {
      throw new UnprocessableEntityException(
        'UNKNOWN_MODULE_CAPABILITY: moduleVersion and supportsBoundedExecution could not be verified at the snapshot block.',
      );
    }
    if (moduleVersion !== 3n || supportsBoundedExecution !== true) {
      throw new UnprocessableEntityException(
        `UNSUPPORTED_MODULE_VERSION: bounded v3 execution requires moduleVersion=3; received ${moduleVersion.toString()} with supportsBoundedExecution=${supportsBoundedExecution}.`,
      );
    }
    try {
      await client.call({
        account: input.callerAddress,
        to: input.moduleAddress,
        data: input.moduleCalldata,
        blockNumber: input.snapshot ? BigInt(input.snapshot.blockNumber) : undefined,
      });
      return {
        status: 'SUCCEEDED' as const,
        reason: null,
        simulatedAt: new Date().toISOString(),
        blockNumber: input.snapshot?.blockNumber ?? null,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'The exact module call reverted.';
      throw new UnprocessableEntityException(`ROUTE_SIMULATION_FAILED: ${reason}`);
    }
  }

  private parseTargetWeights(input?: BasketTargetWeight[]) {
    if (!input || input.length === 0) throw new BadRequestException('targetWeights must contain at least one target asset.');
    const seen = new Set<string>();
    let total = 0;
    for (const target of input) {
      const address = this.parseAddress(target.assetAddress ?? target.address, 'target assetAddress').toLowerCase();
      if (seen.has(address)) throw new BadRequestException(`Duplicate target asset ${address}.`);
      if (!Number.isInteger(target.targetWeightBps) || target.targetWeightBps < 0 || target.targetWeightBps > 10_000) {
        throw new BadRequestException('Every targetWeightBps must be an integer from 0 through 10000.');
      }
      seen.add(address);
      total += target.targetWeightBps;
    }
    if (total !== 10_000) throw new BadRequestException(`Target weights must sum to 10000 bps; received ${total}.`);
    return input;
  }

  private parseSlippage(input?: number) {
    const slippageBps = input ?? 50;
    if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 1_000) {
      throw new BadRequestException('slippageBps must be an integer from 0 through 1000.');
    }
    return slippageBps;
  }

  private parsePositiveAmount(input: string | undefined, field: string) {
    if (!input || !/^[1-9][0-9]*$/.test(input)) {
      throw new BadRequestException(`${field} must be a positive integer base-unit string.`);
    }
    return BigInt(input);
  }

  private parseAddress(input: string | undefined, field: string) {
    if (!input) throw new BadRequestException(`${field} is required.`);
    try {
      return addressSchema.parse(input).toLowerCase() as Address;
    } catch {
      throw new BadRequestException(`${field} must be a valid EVM address.`);
    }
  }

  private requireChainId(input?: number) {
    try {
      return chainIdSchema.parse(input);
    } catch {
      throw new BadRequestException('chainId must be a positive integer.');
    }
  }
}
