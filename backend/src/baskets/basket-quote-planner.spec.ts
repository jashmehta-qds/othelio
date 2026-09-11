import {
  createPortfolioOnlyCapabilities,
  executionPlanSchema,
  PositionSnapshot,
} from '@othelio/shared';
import { decodeFunctionData, parseAbi } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BasketQuotePlannerService } from './basket-quote-planner.service';

const mockedClient = vi.hoisted(() => ({
  readContract: vi.fn(),
  call: vi.fn(),
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => mockedClient),
  };
});

const basket = '0x1111111111111111111111111111111111111111';
const moduleAddress = '0x2222222222222222222222222222222222222222';
const caller = '0x3333333333333333333333333333333333333333';
const overweight = '0x4444444444444444444444444444444444444444';
const underweight = '0x5555555555555555555555555555555555555555';
const thirdAsset = '0x6666666666666666666666666666666666666666';
const router = '0x7777777777777777777777777777777777777777';
const spender = '0x8888888888888888888888888888888888888888';

const REBALANCE_ABI = parseAbi([
  'function rebalance((address safe,(address target,address allowanceSpender,address soldAsset,uint256 maxSoldAmount,bytes dexCalldata)[] legs,address[] soldAssets,uint256[] maxSoldAmounts,address[] boughtAssets,uint256[] minBoughtAmounts,address[] basketTokens,uint256 deadline) p) external returns (uint256[] soldAmounts,uint256[] boughtAmounts,uint256 totalNAV)',
]);
const FUND_ABI = parseAbi([
  'function fundWithSwaps((address safe,address inputAsset,uint256 inputAmount,(address target,address allowanceSpender,uint256 inputAmount,bytes dexCalldata)[] legs,address[] boughtAssets,uint256[] minBoughtAmounts,address[] basketTokens,uint256 deadline) p) external returns (uint256[] boughtAmounts,uint256 totalNAV)',
]);
const FACTORY_ABI = parseAbi(['function createAndSeedBasket(string name,(bytes32 clientSalt,(address safe,address inputAsset,uint256 inputAmount,(address target,address allowanceSpender,uint256 inputAmount,bytes dexCalldata)[] legs,address[] boughtAssets,uint256[] minBoughtAmounts,address[] basketTokens,uint256 deadline) mint) p) external returns (address,uint256[],uint256)']);
const WITHDRAW_IN_KIND_ABI = parseAbi(['function withdrawInKind(address safe,address recipient,address[] tokens,uint256[] amounts,address[] remainingTokens) external returns (uint256 remainingNAV)']);

function snapshot(amounts: Array<[string, string]>): PositionSnapshot {
  return {
    chainId: 8453,
    basketAddress: basket,
    blockNumber: 123,
    blockHash: `0x${'a'.repeat(64)}`,
    observedAt: '2026-09-09T12:00:00.000Z',
    tokens: amounts.map(([assetAddress, liquidAmountBaseUnits]) => ({
      assetAddress,
      decimals: 6,
      liquidAmountBaseUnits,
      priceUsdE8: '100000000',
    })),
    markets: [],
    grossAssetsUsdE8: '100000000000',
    accruedDebtUsdE8: '0',
    equityUsdE8: '100000000000',
    readCompleteness: 'PARTIAL',
    valuationStatus: 'PARTIAL',
    issues: ['POSITION_DISCOVERY_SCOPED_TO_CONFIGURED_AAVE_V3_POOL'],
  };
}

function makePlanner(position: PositionSnapshot) {
  const positions = {
    getPositionSnapshot: vi.fn().mockResolvedValue({
      data: position,
      capabilities: createPortfolioOnlyCapabilities(8453, 'v3'),
    }),
  };
  const dex = {
    getBestQuote: vi.fn().mockImplementation(async (params) => ({
      winningQuote: {
        providerName: '0x',
        chainId: params.chainId,
        sellToken: params.sellToken,
        buyToken: params.buyToken,
        sellAmount: BigInt(params.sellAmount),
        routerAddress: router,
        allowanceSpender: spender,
        recipientAddress: params.takerAddress,
        dexCalldata: '0x1234',
        expectedBuyAmount: 300_000_000n,
        minBuyAmount: 297_000_000n,
        expiresAt: '2099-01-01T00:00:00.000Z',
        estimatedGasUsd: 0.1,
        netBuyAmountUsd: 299.9,
        isAvailable: true,
      },
      allQuotes: [],
    })),
  };
  return {
    dex,
    positions,
    planner: new BasketQuotePlannerService(dex as never, positions as never),
  };
}

describe('BasketQuotePlannerService spot rebalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => (
      functionName === 'moduleVersion' ? 3n : true
    ));
    mockedClient.call.mockResolvedValue({ data: '0x' });
  });

  it('sells the actual overweight asset in a no-USDC basket and binds the exact v3 route', async () => {
    const { planner, dex, positions } = makePlanner(snapshot([
      [overweight, '800000000'],
      [underweight, '200000000'],
    ]));

    const response = await planner.quoteSwaps(basket, {
      action: 'rebalance',
      chainId: 8453,
      moduleAddress,
      callerAddress: caller,
      slippageBps: 100,
      targetWeights: [
        { assetAddress: overweight, targetWeightBps: 5000 },
        { assetAddress: underweight, targetWeightBps: 5000 },
      ],
    });
    if (!('rebalance' in response.data)) throw new Error('Expected a rebalance execution plan.');

    expect(positions.getPositionSnapshot).toHaveBeenCalledWith(basket, 8453, [overweight, underweight]);
    expect(dex.getBestQuote).toHaveBeenCalledWith(expect.objectContaining({
      chainId: 8453,
      sellToken: overweight,
      buyToken: underweight,
      sellAmount: '300000000',
      takerAddress: basket,
    }));
    expect(response.executionAllowed).toBe(true);
    expect(response.data.rebalance).toMatchObject({
      soldAssets: [overweight],
      maxSoldAmounts: ['300000000'],
      boughtAssets: [underweight],
      minBoughtAmounts: ['297000000'],
    });
    expect(executionPlanSchema.parse(response.data.plan).simulation.status).toBe('SUCCEEDED');

    const decoded = decodeFunctionData({
      abi: REBALANCE_ABI,
      data: response.data.plan.calls[0].calldata as `0x${string}`,
    });
    expect(decoded.functionName).toBe('rebalance');
    const params = decoded.args[0];
    expect(params.legs[0].target.toLowerCase()).toBe(router);
    expect(params.legs[0].allowanceSpender.toLowerCase()).toBe(spender);
    expect(params.legs[0].dexCalldata).toBe('0x1234');
    expect(params.soldAssets.map((address) => address.toLowerCase())).toEqual([overweight]);
    expect(params.maxSoldAmounts).toEqual([300_000_000n]);
    expect(params.boughtAssets.map((address) => address.toLowerCase())).toEqual([underweight]);
    expect(params.deadline).toBe(BigInt(Math.floor(new Date('2099-01-01T00:00:00.000Z').getTime() / 1000)));
    expect(mockedClient.call).toHaveBeenCalledWith(expect.objectContaining({
      account: caller,
      to: moduleAddress,
      data: response.data.plan.calls[0].calldata,
      blockNumber: 123n,
    }));
  });

  it('prepares an exact proportional in-kind withdrawal from the canonical liquid snapshot', async () => {
    const { planner, dex, positions } = makePlanner(snapshot([
      [overweight, '800000000'],
      [underweight, '200000000'],
    ]));

    const response = await planner.quoteSwaps(basket, {
      action: 'withdraw',
      chainId: 8453,
      moduleAddress,
      callerAddress: caller,
      recipientAddress: caller,
      withdrawValueUsdE8: '25000000000',
    });

    expect(response.executionAllowed).toBe(true);
    if (!('withdrawal' in response.data)) throw new Error('Expected an in-kind withdrawal plan.');
    expect(response.data.plan.action).toBe('WITHDRAW_LIQUID');
    expect(response.data.withdrawal).toEqual({
      tokens: [overweight, underweight],
      amounts: ['200000000', '50000000'],
      remainingTokens: [overweight, underweight],
    });
    expect(positions.getPositionSnapshot).toHaveBeenCalledWith(basket, 8453);
    expect(dex.getBestQuote).not.toHaveBeenCalled();
    const decoded = decodeFunctionData({ abi: WITHDRAW_IN_KIND_ABI, data: response.data.plan.calls[0].calldata as `0x${string}` });
    expect(decoded.functionName).toBe('withdrawInKind');
    expect(decoded.args[0]).toBe(basket);
    expect(decoded.args[1]).toBe(caller);
    expect(decoded.args[3]).toEqual([200_000_000n, 50_000_000n]);
    expect(mockedClient.call).toHaveBeenCalledWith(expect.objectContaining({
      account: caller,
      to: moduleAddress,
      data: response.data.plan.calls[0].calldata,
      blockNumber: 123n,
    }));
  });

  it('prepares a multi-leg rebalance that sells one asset into multiple buy targets', async () => {
    const { planner, dex } = makePlanner(snapshot([
      [overweight, '600000000'],
      [underweight, '200000000'],
      [thirdAsset, '200000000'],
    ]));

    const response = await planner.quoteSwaps(basket, {
      action: 'rebalance',
      chainId: 8453,
      moduleAddress,
      callerAddress: caller,
      slippageBps: 100,
      targetWeights: [
        { assetAddress: overweight, targetWeightBps: 3400 },
        { assetAddress: underweight, targetWeightBps: 3300 },
        { assetAddress: thirdAsset, targetWeightBps: 3300 },
      ],
    });
    if (!('rebalance' in response.data)) throw new Error('Expected a rebalance execution plan.');
    expect(response.executionAllowed).toBe(true);
    expect(dex.getBestQuote).toHaveBeenCalledTimes(2);
    expect(response.data.rebalance.soldAssets).toEqual([overweight]);
    expect(response.data.rebalance.boughtAssets).toEqual([underweight, thirdAsset]);
  });

  it('keeps every sell asset within its aggregate limit across a multi-sell, multi-buy rebalance', async () => {
    const fourthAsset = '0x9999999999999999999999999999999999999998';
    const { planner, dex } = makePlanner(snapshot([
      [overweight, '500000000'],
      [underweight, '300000000'],
      [thirdAsset, '100000000'],
      [fourthAsset, '100000000'],
    ]));

    const response = await planner.quoteSwaps(basket, {
      action: 'rebalance',
      chainId: 8453,
      moduleAddress,
      callerAddress: caller,
      targetWeights: [
        { assetAddress: overweight, targetWeightBps: 2500 },
        { assetAddress: underweight, targetWeightBps: 1500 },
        { assetAddress: thirdAsset, targetWeightBps: 3000 },
        { assetAddress: fourthAsset, targetWeightBps: 3000 },
      ],
    });

    expect(dex.getBestQuote).toHaveBeenCalledTimes(4);
    const decoded = decodeFunctionData({ abi: REBALANCE_ABI, data: response.data.plan.calls[0].calldata as `0x${string}` });
    const params = decoded.args[0];
    const totals = new Map<string, bigint>();
    for (const leg of params.legs) {
      const key = leg.soldAsset.toLowerCase();
      totals.set(key, (totals.get(key) ?? 0n) + leg.maxSoldAmount);
    }
    expect(totals.get(overweight)).toBe(250_000_000n);
    expect(totals.get(underweight)).toBe(150_000_000n);
    expect(params.maxSoldAmounts).toEqual([250_000_000n, 150_000_000n]);
    expect(params.minBoughtAmounts).toEqual([594_000_000n, 594_000_000n]);
  });

  it('fails explicitly for a legacy module instead of encoding the old selector', async () => {
    const { planner } = makePlanner(snapshot([
      [overweight, '800000000'],
      [underweight, '200000000'],
    ]));
    mockedClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => (
      functionName === 'moduleVersion' ? 1n : false
    ));

    await expect(planner.quoteSwaps(basket, {
      action: 'rebalance',
      chainId: 8453,
      moduleAddress,
      callerAddress: caller,
      targetWeights: [
        { assetAddress: overweight, targetWeightBps: 5000 },
        { assetAddress: underweight, targetWeightBps: 5000 },
      ],
    })).rejects.toThrow('UNSUPPORTED_MODULE_VERSION');
    expect(mockedClient.call).not.toHaveBeenCalled();
  });

  it('does not authorize execution when the exact bounded call simulation reverts', async () => {
    const { planner } = makePlanner(snapshot([
      [overweight, '800000000'],
      [underweight, '200000000'],
    ]));
    mockedClient.call.mockRejectedValue(new Error('ERC20: insufficient allowance'));

    await expect(planner.quoteSwaps(basket, {
      action: 'rebalance',
      chainId: 8453,
      moduleAddress,
      callerAddress: caller,
      targetWeights: [
        { assetAddress: overweight, targetWeightBps: 5000 },
        { assetAddress: underweight, targetWeightBps: 5000 },
      ],
    })).rejects.toThrow('ROUTE_SIMULATION_FAILED: ERC20: insufficient allowance');
  });

  it('uses verified liquid balances even when legacy lending discovery is unavailable', async () => {
    const position = snapshot([
      [overweight, '800000000'],
      [underweight, '200000000'],
    ]);
    position.issues.push('AAVE_RESERVE_DISCOVERY_UNAVAILABLE:0x9999999999999999999999999999999999999999');
    position.markets.push({
      identity: {
        chainId: 8453,
        basketAddress: basket,
        protocol: 'AAVE_V3',
        marketAddress: '0x9999999999999999999999999999999999999999',
        assetAddress: overweight,
      },
      suppliedAmountBaseUnits: '1',
      accruedDebtAmountBaseUnits: '0',
    });
    const { planner, dex } = makePlanner(position);

    const response = await planner.quoteSwaps(basket, {
      action: 'rebalance',
      chainId: 8453,
      moduleAddress,
      callerAddress: caller,
      targetWeights: [
        { assetAddress: overweight, targetWeightBps: 5000 },
        { assetAddress: underweight, targetWeightBps: 5000 },
      ],
    });
    expect(response.executionAllowed).toBe(true);
    expect(dex.getBestQuote).toHaveBeenCalledOnce();
  });

  it('requires an explicit funding amount and never substitutes a fixed USDC budget', async () => {
    const { planner, dex } = makePlanner(snapshot([]));
    await expect(planner.quoteSwaps(basket, {
      action: 'mint',
      chainId: 8453,
      inputAsset: overweight,
      holdings: [{ address: underweight, targetWeightBps: 10_000 }],
    })).rejects.toThrow('inputAmount must be a positive integer');
    expect(dex.getBestQuote).not.toHaveBeenCalled();
  });

  it('creates and simulates a direct single-asset v3 funding plan with the distinct route spender', async () => {
    const { planner } = makePlanner(snapshot([]));
    const response = await planner.quoteSwaps(basket, {
      action: 'mint',
      chainId: 8453,
      moduleAddress,
      callerAddress: caller,
      inputAsset: overweight,
      inputAmount: '300000000',
      holdings: [{ address: underweight, targetWeightBps: 10_000 }],
    });
    if (!('plan' in response.data)) throw new Error('Expected a funding execution plan.');

    expect(response.executionAllowed).toBe(true);
    expect(response.data.plan.approvals).toEqual([{
      tokenAddress: overweight,
      spenderAddress: moduleAddress,
      maxAmountBaseUnits: '300000000',
    }]);
    const decoded = decodeFunctionData({ abi: FUND_ABI, data: response.data.plan.calls[0].calldata as `0x${string}` });
    expect(decoded.functionName).toBe('fundWithSwaps');
    const params = decoded.args[0];
    expect(params.safe.toLowerCase()).toBe(basket);
    expect(params.inputAmount).toBe(300_000_000n);
    expect(params.legs[0].target.toLowerCase()).toBe(router);
    expect(params.legs[0].allowanceSpender.toLowerCase()).toBe(spender);
    expect(params.minBoughtAmounts).toEqual([297_000_000n]);
    expect(mockedClient.call).toHaveBeenCalledWith(expect.objectContaining({
      account: caller,
      to: moduleAddress,
      data: response.data.plan.calls[0].calldata,
    }));
  });

  it('builds one exact factory create-and-seed call with predicted-safe recipients and an exact module approval', async () => {
    const { planner } = makePlanner(snapshot([]));
    const factory = '0x9999999999999999999999999999999999999999';
    const predicted = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    mockedClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'predictBasketAddress') return predicted;
      if (functionName === 'module' || functionName === 'factory') return functionName === 'module' ? moduleAddress : factory;
      return functionName === 'moduleVersion' ? 3n : true;
    });
    const response = await planner.quoteCreateSeed({
      chainId: 8453, factoryAddress: factory, moduleAddress, ownerAddress: caller, name: 'Seeded',
      clientSalt: `0x${'1'.repeat(64)}`, inputAsset: overweight, inputAmount: '300000000',
      targetWeights: [{ assetAddress: underweight, targetWeightBps: 5000 }, { assetAddress: thirdAsset, targetWeightBps: 5000 }],
    });
    expect(response.data.predictedBasketAddress).toBe(predicted);
    expect(response.data.plan.calls).toHaveLength(1);
    expect(response.data.plan.approvals).toEqual([{ tokenAddress: overweight, spenderAddress: moduleAddress, maxAmountBaseUnits: '300000000' }]);
    const decoded = decodeFunctionData({ abi: FACTORY_ABI, data: response.data.plan.calls[0].calldata as `0x${string}` });
    const mint = decoded.args[1].mint;
    expect(mint.safe.toLowerCase()).toBe(predicted);
    expect(mint.legs.map((leg) => leg.inputAmount)).toEqual([150_000_000n, 150_000_000n]);
    expect(mockedClient.call).toHaveBeenCalledWith(expect.objectContaining({ account: caller, to: factory }));
  });
});
