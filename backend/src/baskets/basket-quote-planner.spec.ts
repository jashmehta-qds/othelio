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
  getBlock: vi.fn(),
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
const router = '0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5';
const adapter = '0x7777777777777777777777777777777777777777';
const TYPED_FUND_ABI = parseAbi([
  'struct AerodromeRoute { uint8 kind; address tokenIn; address tokenOut; int24 firstTickSpacing; int24 secondTickSpacing; uint256 amountIn; uint256 minimumAmountOut; }',
  'function fundAerodromePortfolio(address safe,address fundingToken,uint256 totalFundingAmount,AerodromeRoute[] routes,uint256 deadline) external',
]);
const TYPED_SWAP_ABI = parseAbi([
  'struct AerodromeRoute { uint8 kind; address tokenIn; address tokenOut; int24 firstTickSpacing; int24 secondTickSpacing; uint256 amountIn; uint256 minimumAmountOut; }',
  'function rebalanceAerodromePortfolio(address safe,AerodromeRoute[] routes,uint256 deadline) external',
]);
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
        providerName: 'Aerodrome',
        kind: 'DIRECT',
        chainId: params.chainId,
        sellToken: params.sellToken,
        buyToken: params.buyToken,
        sellAmount: BigInt(params.sellAmount),
        routerAddress: router,
        allowanceSpender: router,
        recipientAddress: params.takerAddress,
        tickSpacing: 100,
        firstTickSpacing: 100,
        secondTickSpacing: 0,
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
    mockedClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'moduleVersion') return 3n;
      if (functionName === 'aerodromeAdapter') return adapter;
      if (functionName === 'router') return router;
      if (functionName === 'routeRegistry') return '0x9999999999999999999999999999999999999999';
      if (functionName === 'requireApprovedPool') return ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222'];
      return true;
    });
    mockedClient.call.mockResolvedValue({ data: '0x' });
    mockedClient.getBlock.mockResolvedValue({ timestamp: BigInt(Math.floor(Date.now() / 1_000)) });
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
      abi: TYPED_SWAP_ABI,
      data: response.data.plan.calls[0].calldata as `0x${string}`,
    });
    expect(decoded.functionName).toBe('rebalanceAerodromePortfolio');
    expect(decoded.args[0]).toBe(basket);
    expect((decoded.args[1] as any[])[0]).toMatchObject({
      kind: 0,
      tokenIn: overweight,
      tokenOut: underweight,
      firstTickSpacing: 100,
      secondTickSpacing: 0,
      amountIn: 300_000_000n,
      minimumAmountOut: 297_000_000n,
    });
    expect(mockedClient.call).toHaveBeenCalledWith(expect.objectContaining({
      account: caller,
      to: moduleAddress,
      data: response.data.plan.calls[0].calldata,
      blockNumber: 123n,
    }));
    expect(mockedClient.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: moduleAddress,
      functionName: 'aerodromeAdapter',
    }));
  });

  it('refuses a quote when the deployed portfolio module is not pinned to the reviewed router', async () => {
    mockedClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'moduleVersion') return 3n;
      if (functionName === 'supportsBoundedExecution') return true;
      if (functionName === 'aerodromeAdapter') return adapter;
      if (functionName === 'router') return '0x8888888888888888888888888888888888888888';
      if (functionName === 'routeRegistry') return '0x9999999999999999999999999999999999999999';
      if (functionName === 'requireApprovedPool') return ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222'];
      return true;
    });
    const { planner } = makePlanner(snapshot([
      [overweight, '800000000'],
      [underweight, '200000000'],
    ]));

    await expect(planner.quoteSwaps(basket, {
      action: 'rebalance',
      chainId: 8453,
      moduleAddress,
      callerAddress: caller,
      targetWeights: [
        { assetAddress: overweight, targetWeightBps: 5000 },
        { assetAddress: underweight, targetWeightBps: 5000 },
      ],
    })).rejects.toThrow('UNAPPROVED_AERODROME_ROUTER');
    expect(mockedClient.call).not.toHaveBeenCalled();
  });

  it('refuses a quote when the route registry rejects an unapproved pool', async () => {
    mockedClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'moduleVersion') return 3n;
      if (functionName === 'aerodromeAdapter') return adapter;
      if (functionName === 'router') return router;
      if (functionName === 'routeRegistry') return '0x9999999999999999999999999999999999999999';
      if (functionName === 'requireApprovedPool') throw new Error('UNAPPROVED_AERODROME_POOL');
      return true;
    });
    const { planner } = makePlanner(snapshot([
      [overweight, '800000000'],
      [underweight, '200000000'],
    ]));

    await expect(planner.quoteSwaps(basket, {
      action: 'rebalance',
      chainId: 8453,
      moduleAddress,
      callerAddress: caller,
      targetWeights: [
        { assetAddress: overweight, targetWeightBps: 5000 },
        { assetAddress: underweight, targetWeightBps: 5000 },
      ],
    })).rejects.toThrow('UNAPPROVED_AERODROME_POOL');
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

  it('prepares an atomic multi-leg Base rebalance plan with typed Aerodrome routes', async () => {
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

    expect(response.executionAllowed).toBe(true);
    expect(dex.getBestQuote).toHaveBeenCalledTimes(2);
    const decoded = decodeFunctionData({
      abi: TYPED_SWAP_ABI,
      data: response.data.plan.calls[0].calldata as `0x${string}`,
    });
    expect(decoded.functionName).toBe('rebalanceAerodromePortfolio');
    expect(decoded.args[0]).toBe(basket);
    expect((decoded.args[1] as any[]).length).toBe(2);
  });

  it('prepares multi-sell Base rebalances with atomic route batching', async () => {
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

    expect(response.executionAllowed).toBe(true);
    expect(dex.getBestQuote).toHaveBeenCalledTimes(4);
    const decoded = decodeFunctionData({
      abi: TYPED_SWAP_ABI,
      data: response.data.plan.calls[0].calldata as `0x${string}`,
    });
    expect(decoded.functionName).toBe('rebalanceAerodromePortfolio');
    expect(decoded.args[0]).toBe(basket);
    expect((decoded.args[1] as any[]).length).toBe(4);
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

  it('creates and simulates a direct single-asset typed Aerodrome funding plan', async () => {
    const { planner, dex } = makePlanner(snapshot([]));
    // Deliberately diverge the chain clock from the host clock, as local Anvil
    // forks can do. The contract deadline must remain within its five-minute
    // block.timestamp bound.
    mockedClient.getBlock.mockResolvedValueOnce({ timestamp: 1_000n });
    dex.getBestQuote.mockImplementationOnce(async (params: any) => ({ winningQuote: {
      providerName: 'Aerodrome', kind: 'DIRECT', chainId: 8453, sellToken: params.sellToken, buyToken: params.buyToken,
      sellAmount: BigInt(params.sellAmount), routerAddress: router, allowanceSpender: router,
      recipientAddress: params.takerAddress, tickSpacing: 100, firstTickSpacing: 100, secondTickSpacing: 0,
      expectedBuyAmount: 300_000_000n, minBuyAmount: 297_000_000n,
      expiresAt: '2099-01-01T00:00:00.000Z', estimatedGasUsd: 0.1, netBuyAmountUsd: 299.9, isAvailable: true,
    }, allQuotes: [] }));
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
    const decoded = decodeFunctionData({ abi: TYPED_FUND_ABI, data: response.data.plan.calls[0].calldata as `0x${string}` });
    expect(decoded.functionName).toBe('fundAerodromePortfolio');
    expect(decoded.args[0]).toBe(basket);
    expect(decoded.args[1]).toBe(overweight);
    expect(decoded.args[2]).toBe(300_000_000n);
    expect((decoded.args[3] as any[])[0]).toMatchObject({
      kind: 0,
      tokenIn: overweight,
      tokenOut: underweight,
      firstTickSpacing: 100,
      secondTickSpacing: 0,
      amountIn: 300_000_000n,
      minimumAmountOut: 297_000_000n,
    });
    expect(decoded.args[4]).toBe(1_240n);
    expect(mockedClient.call).toHaveBeenCalledWith(expect.objectContaining({
      account: caller,
      to: moduleAddress,
      data: response.data.plan.calls[0].calldata,
    }));
  });
});
