import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { privateKeyToAccount } from 'viem/accounts';
import {
  BASE_CHAIN_ID,
  BASE_USDC_ADDRESS,
  LIMIT_ORDER_EIP712_TYPES,
  ZERO_EX_EIP712_DOMAIN,
  ZERO_EX_EXCHANGE_PROXY_BASE,
  ZeroExLimitOrder,
  ZeroExSignature,
} from '@othelio/shared';
import { getAddress } from 'viem';
import { OrderbookService } from './orderbook.service';

describe('OrderbookService', () => {
  let service: OrderbookService;

  // Test accounts
  const makerKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const makerAccount = privateKeyToAccount(makerKey);
  const maker = makerAccount.address;

  const takerKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
  const takerAccount = privateKeyToAccount(takerKey);
  const taker = takerAccount.address;

  const seriesAddress = '0x1234567890123456789012345678901234567890';
  const protectedToken = '0x2222222222222222222222222222222222222222';
  const upsideToken = '0x3333333333333333333333333333333333333333';

  const nowSecs = Math.floor(Date.now() / 1000);
  const futureExpiry = nowSecs + 3600; // 1h in future
  const seriesExpiry = nowSecs + 7200; // 2h in future

  let storedOrders: any[] = [];
  let storedTrades: any[] = [];

  const mockDb = {
    query: vi.fn().mockImplementation((query: string, params?: any[]) => {
      if (query.includes('SELECT order_hash FROM risk_split_orders WHERE order_hash = $1')) {
        const hash = params?.[0];
        const match = storedOrders.find((o) => o.order_hash === hash);
        return Promise.resolve({ rows: match ? [match] : [] });
      }
      if (query.includes('INSERT INTO risk_split_orders')) {
        const newOrder = {
          order_hash: params?.[0],
          chain_id: params?.[1],
          series_address: params?.[2],
          claim_type: params?.[3],
          claim_token: params?.[4],
          quote_token: params?.[5],
          side: params?.[6],
          maker_address: params?.[7],
          taker_address: params?.[8],
          maker_token: params?.[9],
          taker_token: params?.[10],
          maker_amount: params?.[11],
          taker_amount: params?.[12],
          remaining_maker_amount: params?.[13],
          remaining_taker_amount: params?.[14],
          price_usd_e6: params?.[15],
          expiry_timestamp: params?.[16],
          salt: params?.[17],
          verifying_contract: params?.[18],
          signature: params?.[19],
          order_status: 'FILLABLE',
          is_locally_hidden: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        storedOrders.push(newOrder);
        return Promise.resolve({ rows: [newOrder] });
      }
      if (query.includes('SELECT * FROM risk_split_orders WHERE order_hash = $1')) {
        const hash = params?.[0];
        const match = storedOrders.find((o) => o.order_hash === hash);
        return Promise.resolve({ rows: match ? [match] : [] });
      }
      if (query.includes('FROM risk_split_orders') && query.includes('LOWER(series_address) = $2')) {
        const match = storedOrders.filter((o) => o.order_status === 'FILLABLE' && !o.is_locally_hidden);
        return Promise.resolve({ rows: match });
      }
      if (query.includes('is_locally_hidden = true')) {
        const hash = params?.[0];
        const match = storedOrders.find((o) => o.order_hash === hash);
        if (match) {
          match.is_locally_hidden = true;
          match.order_status = 'LOCALLY_HIDDEN';
        }
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('remaining_taker_amount = $1')) {
        const remTaker = params?.[0];
        const remMaker = params?.[1];
        const status = params?.[2];
        const hash = params?.[3];
        const match = storedOrders.find((o) => o.order_hash === hash);
        if (match) {
          match.remaining_taker_amount = remTaker;
          match.remaining_maker_amount = remMaker;
          match.order_status = status;
        }
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('INSERT INTO risk_split_trades')) {
        storedTrades.push(params);
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('FROM risk_split_trades')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    }),
  };

  const mockRiskSplitService = {
    getSeries: vi.fn().mockResolvedValue({
      seriesAddress,
      isSettled: false,
      expiryTimestamp: seriesExpiry,
      protectedTokenAddress: protectedToken,
      upsideTokenAddress: upsideToken,
    }),
    getIndexerFreshness: vi.fn().mockResolvedValue({
      lastIndexedBlock: 1000,
      isFresh: true,
      blockLag: 0,
    }),
  };

  beforeEach(() => {
    storedOrders = [];
    storedTrades = [];
    service = new OrderbookService(mockDb as any, mockRiskSplitService as any);
    (service as any).getClaimDecimals = async () => 8;
    (service as any).createVenueClient = () => ({
      readContract: async ({ functionName, args }: { functionName: string; args?: any[] }) => {
        if (functionName === 'getLimitOrderInfo') {
          const encoded = args?.[0];
          return {
            orderHash: service.computeOrderHash({
              ...encoded,
              makerAmount: String(encoded.makerAmount),
              takerAmount: String(encoded.takerAmount),
              takerTokenFeeAmount: String(encoded.takerTokenFeeAmount),
              expiry: Number(encoded.expiry),
              salt: String(encoded.salt),
            }),
            status: 1,
            takerTokenFilledAmount: 0n,
          };
        }
        if (functionName === 'balanceOf' || functionName === 'allowance') return 1000000000000n;
        if (functionName === 'decimals') return 8;
        throw new Error(`Unexpected contract read: ${functionName}`);
      },
    });
  });

  async function createSignedBuyOrder(saltStr = '1001', claimUnits = '100000000') {
    // BUY Claim: maker offering 400 USDC (400 * 1e6) for 1 Protected Claim (1 * 1e8)
    const order: ZeroExLimitOrder = {
      makerToken: BASE_USDC_ADDRESS,
      takerToken: protectedToken as `0x${string}`,
      makerAmount: '400000000', // 400 USDC
      takerAmount: claimUnits, // 1.0 Protected Claim in token base units
      takerTokenFeeAmount: '0',
      maker: maker as `0x${string}`,
      taker: '0x0000000000000000000000000000000000000000',
      sender: '0x0000000000000000000000000000000000000000',
      feeRecipient: '0x0000000000000000000000000000000000000000',
      pool: '0x0000000000000000000000000000000000000000000000000000000000000000',
      expiry: futureExpiry,
      salt: saltStr,
    };

    const domain = {
      ...ZERO_EX_EIP712_DOMAIN,
      chainId: BASE_CHAIN_ID,
      verifyingContract: ZERO_EX_EXCHANGE_PROXY_BASE,
    };

    const rawSig = await makerAccount.signTypedData({
      domain,
      types: LIMIT_ORDER_EIP712_TYPES,
      primaryType: 'LimitOrder',
      message: {
        makerToken: getAddress(order.makerToken),
        takerToken: getAddress(order.takerToken),
        makerAmount: BigInt(order.makerAmount),
        takerAmount: BigInt(order.takerAmount),
        takerTokenFeeAmount: 0n,
        maker: getAddress(order.maker),
        taker: getAddress(order.taker),
        sender: getAddress(order.sender),
        feeRecipient: getAddress(order.feeRecipient),
        pool: order.pool as `0x${string}`,
        expiry: BigInt(order.expiry),
        salt: BigInt(order.salt),
      },
    });

    const signature: ZeroExSignature = {
      signatureType: 2,
      v: parseInt(rawSig.slice(130, 132), 16),
      r: rawSig.slice(0, 66) as `0x${string}`,
      s: ('0x' + rawSig.slice(66, 130)) as `0x${string}`,
    };

    return { order, signature };
  }

  it('validates and persists a signed BUY limit order with correct price and priority', async () => {
    const { order, signature } = await createSignedBuyOrder('2001');

    const result = await service.validateAndStoreOrder({
      order,
      signature,
      chainId: BASE_CHAIN_ID,
      seriesAddress,
      claimType: 'PROTECTED',
    });

    expect(result.orderHash).toBeDefined();
    expect(result.side).toBe('BUY');
    expect(result.priceUsdE6).toBe('400000000'); // $400.00
    expect(result.orderStatus).toBe('FILLABLE');
    expect(storedOrders.length).toBe(1);
  });

  it('normalizes the price of a six-decimal claim', async () => {
    (service as any).getClaimDecimals = async () => 6;
    const { order, signature } = await createSignedBuyOrder('2011', '1000000');
    const stored = await service.validateAndStoreOrder({ order, signature, chainId: BASE_CHAIN_ID, seriesAddress, claimType: 'PROTECTED' });
    expect(stored.priceUsdE6).toBe('400000000');
  });

  it('rejects order with invalid cryptographic signature', async () => {
    const { order, signature } = await createSignedBuyOrder('2002');
    const corruptedSignature: ZeroExSignature = {
      ...signature,
      v: signature.v === 27 ? 28 : 27, // Invert v
    };

    await expect(
      service.validateAndStoreOrder({
        order,
        signature: corruptedSignature,
        chainId: BASE_CHAIN_ID,
        seriesAddress,
        claimType: 'PROTECTED',
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects order when expiry exceeds series expiry', async () => {
    const { order, signature } = await createSignedBuyOrder('2003');
    order.expiry = seriesExpiry + 1000; // Past series maturity!

    await expect(
      service.validateAndStoreOrder({
        order,
        signature,
        chainId: BASE_CHAIN_ID,
        seriesAddress,
        claimType: 'PROTECTED',
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects restricted or fee-bearing orders from the public book', async () => {
    const { order, signature } = await createSignedBuyOrder('2013');
    order.takerTokenFeeAmount = '1';
    await expect(service.validateAndStoreOrder({ order, signature, chainId: BASE_CHAIN_ID, seriesAddress, claimType: 'PROTECTED' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate order (replay attack)', async () => {
    const { order, signature } = await createSignedBuyOrder('2004');

    await service.validateAndStoreOrder({
      order,
      signature,
      chainId: BASE_CHAIN_ID,
      seriesAddress,
      claimType: 'PROTECTED',
    });

    // Submitting again with identical nonce/hash
    await expect(
      service.validateAndStoreOrder({
        order,
        signature,
        chainId: BASE_CHAIN_ID,
        seriesAddress,
        claimType: 'PROTECTED',
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('removes a resting bid from executable depth after maker allowance is revoked', async () => {
    const { order, signature } = await createSignedBuyOrder('2010');
    await service.validateAndStoreOrder({
      order,
      signature,
      chainId: BASE_CHAIN_ID,
      seriesAddress,
      claimType: 'PROTECTED',
    });

    let allowance = BigInt(order.makerAmount);
    (service as any).createVenueClient = () => ({
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === 'getLimitOrderInfo') {
          return { orderHash: service.computeOrderHash(order), status: 1, takerTokenFilledAmount: 0n };
        }
        if (functionName === 'balanceOf') return BigInt(order.makerAmount);
        if (functionName === 'allowance') return allowance;
        if (functionName === 'decimals') return 8;
        throw new Error(`Unexpected contract read: ${functionName}`);
      },
    });

    expect((await service.getOrderBook(seriesAddress, 'PROTECTED')).bids).toHaveLength(1);
    allowance = 0n;
    expect((await service.getOrderBook(seriesAddress, 'PROTECTED')).bids).toHaveLength(0);
  });

  it('builds fill transaction and rejects self-match', async () => {
    const { order, signature } = await createSignedBuyOrder('2005');
    const stored = await service.validateAndStoreOrder({
      order,
      signature,
      chainId: BASE_CHAIN_ID,
      seriesAddress,
      claimType: 'PROTECTED',
    });

    // 1. Self-match rejected
    await expect(
      service.buildFillTransaction(stored.orderHash, {
        takerAddress: maker, // Same as maker!
        takerTokenFillAmount: '50000000',
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    // 2. Opposing taker wallet build succeeds
    const fillTx = await service.buildFillTransaction(stored.orderHash, {
      takerAddress: taker,
      takerTokenFillAmount: '50000000', // 0.5 claim partial fill
    });

    expect(fillTx.target).toBe(ZERO_EX_EXCHANGE_PROXY_BASE);
    expect(fillTx.method).toBe('fillLimitOrder');
    expect(fillTx.orderHash).toBe(stored.orderHash);
    expect(() => JSON.stringify(fillTx)).not.toThrow();
  });

  it('rejects a fill build after maker allowance is revoked', async () => {
    const { order, signature } = await createSignedBuyOrder('2012');
    const stored = await service.validateAndStoreOrder({ order, signature, chainId: BASE_CHAIN_ID, seriesAddress, claimType: 'PROTECTED' });
    (service as any).createVenueClient = () => ({
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === 'getLimitOrderInfo') return { orderHash: stored.orderHash, status: 1, takerTokenFilledAmount: 0n };
        if (functionName === 'balanceOf') return BigInt(order.makerAmount);
        if (functionName === 'allowance') return 0n;
        throw new Error(`Unexpected contract read: ${functionName}`);
      },
    });
    await expect(service.buildFillTransaction(stored.orderHash, { takerAddress: taker, takerTokenFillAmount: '1000000' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('builds an onchain cancel without hiding a maker order before confirmation', async () => {
    const { order, signature } = await createSignedBuyOrder('2006');
    const stored = await service.validateAndStoreOrder({
      order,
      signature,
      chainId: BASE_CHAIN_ID,
      seriesAddress,
      claimType: 'PROTECTED',
    });

    // Non-maker cannot cancel
    await expect(service.cancelOrderIntent(stored.orderHash, taker)).rejects.toBeInstanceOf(
      UnauthorizedException
    );

    // Maker cancels
    const cancelRes = await service.cancelOrderIntent(stored.orderHash, maker);
    expect(cancelRes.isLocallyHidden).toBe(false);
    expect(cancelRes.cancelTx.method).toBe('cancelLimitOrder');

    // A caller-supplied address is not authorization to mutate the public book.
    const orderInDb = storedOrders.find((o) => o.order_hash === stored.orderHash);
    expect(orderInDb.is_locally_hidden).toBe(false);
  });

  it('reconciles partial fills onchain and updates remaining quantity', async () => {
    const { order, signature } = await createSignedBuyOrder('2007');
    const stored = await service.validateAndStoreOrder({
      order,
      signature,
      chainId: BASE_CHAIN_ID,
      seriesAddress,
      claimType: 'PROTECTED',
    });

    // Partial fill 50%
    await service.recordOnchainFill(
      stored.orderHash,
      taker,
      50000000n, // half taker
      200000000n, // half maker
      '0xabc123',
      1234
    );

    const orderInDb = storedOrders.find((o) => o.order_hash === stored.orderHash);
    expect(orderInDb.remaining_taker_amount).toBe('50000000');
    expect(orderInDb.remaining_maker_amount).toBe('200000000');
    expect(orderInDb.order_status).toBe('FILLABLE');

    // Remaining fill 50%
    await service.recordOnchainFill(
      stored.orderHash,
      taker,
      50000000n,
      200000000n,
      '0xabc456',
      1235
    );

    expect(orderInDb.remaining_taker_amount).toBe('0');
    expect(orderInDb.order_status).toBe('FILLED');
  });
});
