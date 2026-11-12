import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UpsideOrderbookService,
  LIMIT_ORDER_EIP712_TYPES,
  ZERO_EX_DOMAIN_NAME,
  ZERO_EX_DOMAIN_VERSION,
} from './upside-orderbook.service';
import { privateKeyToAccount } from 'viem/accounts';
import { BASE_USDC_ADDRESS } from '../config/addresses';
import {
  ZERO_EX_EXCHANGE_PROXY_BASE,
  UpsideLimitOrder,
  UpsideSignature,
} from '@othelio/shared';
import { getAddress, parseSignature } from 'viem';

describe('UpsideOrderbookService', () => {
  let service: UpsideOrderbookService;
  let mockDb: any;

  // Test account for maker
  const testPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // standard test key
  const account = privateKeyToAccount(testPrivateKey);
  const makerAddress = account.address;

  const chainId = 8453;
  const seriesAddress = '0x1111111111111111111111111111111111111111';
  const claimTokenAddress = '0x2222222222222222222222222222222222222222';
  const usdcAddress = BASE_USDC_ADDRESS;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    service = new UpsideOrderbookService(mockDb);
  });

  function createTestOrder(overrides: Partial<UpsideLimitOrder> = {}): UpsideLimitOrder {
    const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
    return {
      makerToken: claimTokenAddress as `0x${string}`,
      takerToken: usdcAddress as `0x${string}`,
      makerAmount: '100000000',
      takerAmount: '4100000',
      maker: makerAddress,
      taker: '0x0000000000000000000000000000000000000000',
      feeRecipient: '0x0000000000000000000000000000000000000000',
      pool: '0x0000000000000000000000000000000000000000000000000000000000000000',
      expiry: futureExpiry.toString(),
      salt: '1',
      takerTokenFeeAmount: '0',
      sender: '0x0000000000000000000000000000000000000000',
      ...overrides,
    };
  }

  async function signOrder(order: UpsideLimitOrder): Promise<UpsideSignature> {
    const domain = {
      name: ZERO_EX_DOMAIN_NAME,
      version: ZERO_EX_DOMAIN_VERSION,
      chainId: BigInt(chainId),
      verifyingContract: ZERO_EX_EXCHANGE_PROXY_BASE as `0x${string}`,
    };

    const signatureHex = await account.signTypedData({
      domain,
      types: LIMIT_ORDER_EIP712_TYPES,
      primaryType: 'LimitOrder',
      message: {
        makerToken: getAddress(order.makerToken),
        takerToken: getAddress(order.takerToken),
        makerAmount: BigInt(order.makerAmount),
        takerAmount: BigInt(order.takerAmount),
        takerTokenFeeAmount: BigInt(order.takerTokenFeeAmount || '0'),
        maker: getAddress(order.maker),
        taker: getAddress(order.taker || '0x0000000000000000000000000000000000000000'),
        sender: getAddress(order.sender || '0x0000000000000000000000000000000000000000'),
        feeRecipient: getAddress(order.feeRecipient || '0x0000000000000000000000000000000000000000'),
        pool: (order.pool || '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`,
        expiry: BigInt(order.expiry),
        salt: BigInt(order.salt),
      },
    });

    const parsed = parseSignature(signatureHex);
    return {
      r: parsed.r,
      s: parsed.s,
      v: Number(parsed.v),
      signatureType: 2, // EIP-712
    };
  }

  describe('EIP-712 Order Hashing and Signature Verification', () => {
    it('computes deterministic order hash and verifies valid signature', async () => {
      const order = createTestOrder({
        makerAmount: '100000000',
        takerAmount: '4100000',
        salt: '123456789',
      });

      const hash1 = service.computeOrderHash(chainId, order);
      const hash2 = service.computeOrderHash(chainId, order);
      expect(hash1).toBe(hash2);
      expect(hash1.startsWith('0x')).toBe(true);

      const sig = await signOrder(order);
      const isValid = await service.verifyOrderSignature(chainId, order, sig);
      expect(isValid).toBe(true);

      // Tampered order should fail verification
      const tamperedOrder = { ...order, makerAmount: '200000000' };
      const isTamperedValid = await service.verifyOrderSignature(chainId, tamperedOrder, sig);
      expect(isTamperedValid).toBe(false);
    });
  });

  describe('createOrder validation', () => {
    it('rejects order with expired timestamp', async () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 60;
      const order = createTestOrder({ expiry: pastExpiry.toString() });
      const sig = await signOrder(order);

      await expect(
        service.createOrder(chainId, {
          chainId,
          seriesAddress,
          claimType: 'UPSIDE',
          order,
          signature: sig,
        }),
      ).rejects.toThrow('Order expiry must be strictly in the future');
    });

    it('rejects order if neither token is USDC', async () => {
      const order = createTestOrder({
        takerToken: '0x3333333333333333333333333333333333333333' as `0x${string}`,
      });
      const sig = await signOrder(order);

      await expect(
        service.createOrder(chainId, {
          chainId,
          seriesAddress,
          claimType: 'UPSIDE',
          order,
          signature: sig,
        }),
      ).rejects.toThrow('One order token must be USDC');
    });

    it('rejects order with invalid maker signature', async () => {
      const order = createTestOrder();
      const fakeSig: UpsideSignature = {
        r: '0x1111111111111111111111111111111111111111111111111111111111111111',
        s: '0x2222222222222222222222222222222222222222222222222222222222222222',
        v: 27,
        signatureType: 2,
      };

      await expect(
        service.createOrder(chainId, {
          chainId,
          seriesAddress,
          claimType: 'UPSIDE',
          order,
          signature: fakeSig,
        }),
      ).rejects.toThrow('Invalid EIP-712 signature');
    });

    it('accepts and stores valid SELL and BUY orders', async () => {
      // SELL order: maker sells 1 claim for $4.10 USDC
      const sellOrder = createTestOrder({
        makerToken: claimTokenAddress as `0x${string}`,
        takerToken: usdcAddress as `0x${string}`,
        makerAmount: '100000000', // 1 unit
        takerAmount: '4100000', // $4.10 USDC
        salt: '100',
      });
      const sellSig = await signOrder(sellOrder);
      const storedSell = await service.createOrder(chainId, {
        chainId,
        seriesAddress,
        claimType: 'UPSIDE',
        order: sellOrder,
        signature: sellSig,
      });

      expect(storedSell.side).toBe('SELL');
      expect(storedSell.priceFormatted).toBe('4.1000');
      expect(storedSell.orderStatus).toBe('FILLABLE');

      // BUY order: maker buys 1 claim with $4.00 USDC
      const buyOrder = createTestOrder({
        makerToken: usdcAddress as `0x${string}`,
        takerToken: claimTokenAddress as `0x${string}`,
        makerAmount: '4000000', // $4.00 USDC
        takerAmount: '100000000', // 1 unit
        salt: '101',
      });
      const buySig = await signOrder(buyOrder);
      const storedBuy = await service.createOrder(chainId, {
        chainId,
        seriesAddress,
        claimType: 'UPSIDE',
        order: buyOrder,
        signature: buySig,
      });

      expect(storedBuy.side).toBe('BUY');
      expect(storedBuy.priceFormatted).toBe('4.0000');
      expect(storedBuy.orderStatus).toBe('FILLABLE');
    });
  });

  describe('getOrderBook aggregation', () => {
    it('aggregates bids descending and asks ascending with level grouping', async () => {
      // Add two SELL orders at $4.10 (0.5 and 0.5 units) -> should aggregate to 1.0 @ $4.10
      const sell1 = createTestOrder({
        makerToken: claimTokenAddress as `0x${string}`,
        takerToken: usdcAddress as `0x${string}`,
        makerAmount: '50000000', // 0.5
        takerAmount: '2050000', // 0.5 * 4.10 = 2.05
        salt: '201',
      });
      const sell2 = createTestOrder({
        makerToken: claimTokenAddress as `0x${string}`,
        takerToken: usdcAddress as `0x${string}`,
        makerAmount: '50000000', // 0.5
        takerAmount: '2050000', // 2.05
        salt: '202',
      });
      // Add one SELL order at $4.20 (0.7 units)
      const sell3 = createTestOrder({
        makerToken: claimTokenAddress as `0x${string}`,
        takerToken: usdcAddress as `0x${string}`,
        makerAmount: '70000000', // 0.7
        takerAmount: '2940000', // 0.7 * 4.20 = 2.94
        salt: '203',
      });

      await service.createOrder(chainId, { chainId, seriesAddress, claimType: 'UPSIDE', order: sell1, signature: await signOrder(sell1) });
      await service.createOrder(chainId, { chainId, seriesAddress, claimType: 'UPSIDE', order: sell2, signature: await signOrder(sell2) });
      await service.createOrder(chainId, { chainId, seriesAddress, claimType: 'UPSIDE', order: sell3, signature: await signOrder(sell3) });

      const depth = await service.getOrderBook(chainId, seriesAddress, 'UPSIDE');

      // Asks sorted ascending
      expect(depth.asks.length).toBe(2);
      expect(depth.asks[0].priceUsd).toBe('4.1000');
      expect(depth.asks[0].amountClaim).toBe('100000000'); // 0.5 + 0.5 = 1.0 unit (1e8)
      expect(depth.asks[0].orderCount).toBe(2);

      expect(depth.asks[1].priceUsd).toBe('4.2000');
      expect(depth.asks[1].amountClaim).toBe('70000000'); // 0.7 unit (7e7)
      expect(depth.asks[1].orderCount).toBe(1);
    });
  });

  describe('getSweepQuote calculation and multi-level execution', () => {
    it('calculates multi-level sweep for buying claims: 0.5@$4.10 + 0.7@$4.20 = $4.99 total cost', async () => {
      const service2 = new UpsideOrderbookService();

      const ask1 = createTestOrder({
        makerToken: claimTokenAddress as `0x${string}`,
        takerToken: usdcAddress as `0x${string}`,
        makerAmount: '50000000', // 0.5 claims
        takerAmount: '2050000', // $2.05 USDC
        salt: '301',
      });
      const ask2 = createTestOrder({
        makerToken: claimTokenAddress as `0x${string}`,
        takerToken: usdcAddress as `0x${string}`,
        makerAmount: '70000000', // 0.7 claims
        takerAmount: '2940000', // $2.94 USDC
        salt: '302',
      });

      await service2.createOrder(chainId, { chainId, seriesAddress, claimType: 'UPSIDE', order: ask1, signature: await signOrder(ask1) });
      await service2.createOrder(chainId, { chainId, seriesAddress, claimType: 'UPSIDE', order: ask2, signature: await signOrder(ask2) });

      // Request sweep of 1.2 units (120,000,000)
      const sweepRouterAddress = '0x9999999999999999999999999999999999999999';
      const quote = await service2.getSweepQuote(
        chainId,
        seriesAddress,
        {
          seriesAddress: seriesAddress as `0x${string}`,
          takerAddress: makerAddress,
          claimType: 'UPSIDE',
          side: 'BUY',
          requestedUnits: '120000000',
        },
        sweepRouterAddress,
      );

      expect(quote.executableUnits).toBe('120000000');
      // 2.05 + 2.94 = 4.99 USDC = 4990000
      expect(quote.totalCostUsdc).toBe('4990000');
      expect(quote.levels.length).toBe(2);
      expect(quote.levels[0].claimUnits).toBe('50000000');
      expect(quote.levels[0].usdcCost).toBe('2050000');
      expect(quote.levels[1].claimUnits).toBe('70000000');
      expect(quote.levels[1].usdcCost).toBe('2940000');

      // Uses UpsideBatchFillRouter
      expect(quote.to).toBe(sweepRouterAddress);
      expect(quote.transactionData).toBeDefined();
      expect(quote.revertIfIncomplete).toBe(true);
    });
  });

  describe('cancelOrderIntent', () => {
    it('locally hides order and generates cancel transaction for maker', async () => {
      const order = createTestOrder({ salt: '401' });
      const sig = await signOrder(order);
      const stored = await service.createOrder(chainId, { chainId, seriesAddress, claimType: 'UPSIDE', order, signature: sig });

      // Non-maker cannot cancel
      const attacker = '0x8888888888888888888888888888888888888888';
      await expect(service.cancelOrderIntent(stored.orderHash, attacker)).rejects.toThrow(
        'Only the order maker can cancel this order',
      );

      // Maker cancels
      const cancelRes = await service.cancelOrderIntent(stored.orderHash, makerAddress);
      expect(cancelRes.status).toBe('LOCALLY_HIDDEN');
      expect(cancelRes.cancelTransactionData.to).toBe(ZERO_EX_EXCHANGE_PROXY_BASE);
      expect(cancelRes.cancelTransactionData.data.startsWith('0x')).toBe(true);

      // Order should no longer appear in open orderbook depth
      const depth = await service.getOrderBook(chainId, seriesAddress, 'UPSIDE');
      const foundInAsks = depth.asks.find((a) => a.orderHash === stored.orderHash);
      expect(foundInAsks).toBeUndefined();
    });
  });
});
