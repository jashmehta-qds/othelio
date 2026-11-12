import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpsideService } from './upside.service';
import {
  BASE_CHAIN_ID,
  BASE_FORK_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  ZERO_EX_EXCHANGE_PROXY_BASE,
  ZERO_EX_LIMIT_ORDER_ABI,
  UPSIDE_BATCH_FILL_ROUTER_ABI,
  buildCancelLimitOrderTx,
  buildFillLimitOrderTx,
  buildBatchFillLimitOrdersTx,
  UpsideLimitOrder,
  UpsideSignature,
  UpsideSweepQuoteRequest,
  UpsideSweepQuoteResponse,
  UpsideSweepQuoteLevel,
} from '@othelio/shared';
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  getAddress,
  hashTypedData,
  http,
  isAddress,
  parseAbi,
  parseUnits,
  verifyTypedData,
} from 'viem';
import { rpcUrlForChain } from '../config/network-runtime';
import { BASE_USDC_ADDRESS } from '../config/addresses';
import {
  CreateUpsideOrderDto,
  UpsideCancelIntentResponse,
  UpsideOrderBookDepth,
  UpsideOrderBookLevel,
  UpsideOrderBookTrade,
  UpsideStoredOrderModel,
} from './upside-orderbook.types';

export const ZERO_EX_DOMAIN_NAME = 'ZeroEx';
export const ZERO_EX_DOMAIN_VERSION = '1.0.0';

export const LIMIT_ORDER_EIP712_TYPES = {
  LimitOrder: [
    { name: 'makerToken', type: 'address' },
    { name: 'takerToken', type: 'address' },
    { name: 'makerAmount', type: 'uint128' },
    { name: 'takerAmount', type: 'uint128' },
    { name: 'takerTokenFeeAmount', type: 'uint128' },
    { name: 'maker', type: 'address' },
    { name: 'taker', type: 'address' },
    { name: 'sender', type: 'address' },
    { name: 'feeRecipient', type: 'address' },
    { name: 'pool', type: 'bytes32' },
    { name: 'expiry', type: 'uint64' },
    { name: 'salt', type: 'uint256' },
  ],
} as const;

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

@Injectable()
export class UpsideOrderbookService {
  private readonly logger = new Logger(UpsideOrderbookService.name);
  private bookSequence = 1;

  // In-memory orders map for fallback / test mode
  private mockOrders: Map<string, UpsideStoredOrderModel> = new Map();
  private mockTrades: Map<string, UpsideOrderBookTrade[]> = new Map();

  constructor(
    @Optional() private readonly db?: DatabaseService,
    @Optional() private readonly upsideService?: UpsideService,
  ) {}

  private createClient(chainId: number) {
    const rpcUrl = rpcUrlForChain(chainId);
    if (!rpcUrl) return null;
    return createPublicClient({ transport: http(rpcUrl) });
  }

  private getEIP712Domain(chainId: number) {
    return {
      name: ZERO_EX_DOMAIN_NAME,
      version: ZERO_EX_DOMAIN_VERSION,
      chainId: BigInt(chainId),
      verifyingContract: ZERO_EX_EXCHANGE_PROXY_BASE as `0x${string}`,
    };
  }

  computeOrderHash(chainId: number, order: UpsideLimitOrder): `0x${string}` {
    return hashTypedData({
      domain: this.getEIP712Domain(chainId),
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
  }

  async verifyOrderSignature(chainId: number, order: UpsideLimitOrder, signature: UpsideSignature): Promise<boolean> {
    try {
      const isValid = await verifyTypedData({
        address: getAddress(order.maker),
        domain: this.getEIP712Domain(chainId),
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
        signature: {
          r: signature.r,
          s: signature.s,
          v: BigInt(signature.v),
        },
      });
      return isValid;
    } catch {
      return false;
    }
  }

  async createOrder(chainId: number, dto: CreateUpsideOrderDto): Promise<UpsideStoredOrderModel> {
    const { seriesAddress, claimType, order, signature } = dto;

    if (!order || !signature) {
      throw new BadRequestException('Order and signature are required');
    }

    const orderHash = this.computeOrderHash(chainId, order);

    // Verify signature
    const isValidSig = await this.verifyOrderSignature(chainId, order, signature);
    if (!isValidSig) {
      throw new UnauthorizedException('Invalid EIP-712 signature for order maker');
    }

    // Verify expiry in future
    const nowSecs = Math.floor(Date.now() / 1000);
    if (Number(order.expiry) <= nowSecs) {
      throw new BadRequestException('Order expiry must be strictly in the future');
    }

    // Identify side and tokens
    const makerToken = getAddress(order.makerToken);
    const takerToken = getAddress(order.takerToken);
    const usdcAddr = getAddress(BASE_USDC_ADDRESS);

    let side: 'BUY' | 'SELL';
    let claimToken: string;
    let quoteToken = usdcAddr;

    if (takerToken.toLowerCase() === usdcAddr.toLowerCase()) {
      // Maker sells claimToken for USDC
      side = 'SELL';
      claimToken = makerToken;
    } else if (makerToken.toLowerCase() === usdcAddr.toLowerCase()) {
      // Maker buys claimToken with USDC
      side = 'BUY';
      claimToken = takerToken;
    } else {
      throw new BadRequestException('One order token must be USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)');
    }

    // Claim decimals (default 8, or MSFTc 8)
    const claimDecimals = 8;
    const makerAmountBig = BigInt(order.makerAmount);
    const takerAmountBig = BigInt(order.takerAmount);

    if (makerAmountBig <= 0n || takerAmountBig <= 0n) {
      throw new BadRequestException('Maker and taker amounts must be positive');
    }

    // Price calculation in USD (1e6)
    let priceUsdE6Big: bigint;
    if (side === 'SELL') {
      // Maker sells makerAmount claims for takerAmount USDC
      // price per unit = takerAmount (6 dec) / makerAmount (claimDecimals)
      priceUsdE6Big = (takerAmountBig * BigInt(10 ** claimDecimals)) / makerAmountBig;
    } else {
      // Maker buys takerAmount claims with makerAmount USDC
      // price per unit = makerAmount (6 dec) / takerAmount (claimDecimals)
      priceUsdE6Big = (makerAmountBig * BigInt(10 ** claimDecimals)) / takerAmountBig;
    }

    if (priceUsdE6Big <= 0n) {
      throw new BadRequestException('Computed order price is zero or invalid');
    }

    const priceUsdE6 = priceUsdE6Big.toString();
    const priceFormatted = (Number(priceUsdE6Big) / 1e6).toFixed(4);

    const storedOrder: UpsideStoredOrderModel = {
      orderHash,
      chainId,
      seriesAddress: getAddress(seriesAddress),
      claimType,
      claimToken,
      quoteToken,
      side,
      makerAddress: getAddress(order.maker),
      takerAddress: getAddress(order.taker || '0x0000000000000000000000000000000000000000'),
      makerToken,
      takerToken,
      makerAmount: order.makerAmount,
      takerAmount: order.takerAmount,
      remainingMakerAmount: order.makerAmount,
      remainingTakerAmount: order.takerAmount,
      priceUsdE6,
      priceFormatted,
      expiryTimestamp: Number(order.expiry),
      salt: order.salt,
      verifyingContract: ZERO_EX_EXCHANGE_PROXY_BASE,
      signature,
      orderStatus: 'FILLABLE',
      isLocallyHidden: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (this.db) {
      try {
        const query = `
          INSERT INTO upside_orders (
            order_hash, chain_id, series_address, claim_type, claim_token, quote_token,
            side, maker_address, taker_address, maker_token, taker_token,
            maker_amount, taker_amount, remaining_maker_amount, remaining_taker_amount,
            price_usd_e6, expiry_timestamp, salt, verifying_contract, signature,
            order_status, is_locally_hidden, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12::numeric, $13::numeric, $14::numeric, $15::numeric,
            $16::numeric, $17, $18::numeric, $19, $20,
            $21, $22, NOW(), NOW()
          )
        `;
        await this.db.query(query, [
          orderHash,
          chainId,
          storedOrder.seriesAddress,
          claimType,
          claimToken,
          quoteToken,
          side,
          storedOrder.makerAddress,
          storedOrder.takerAddress,
          makerToken,
          takerToken,
          order.makerAmount,
          order.takerAmount,
          order.makerAmount,
          order.takerAmount,
          priceUsdE6,
          storedOrder.expiryTimestamp,
          order.salt,
          ZERO_EX_EXCHANGE_PROXY_BASE,
          JSON.stringify(signature),
          'FILLABLE',
          false,
        ]);
      } catch (err: any) {
        if (err?.code === '23505') {
          throw new ConflictException(`Order hash ${orderHash} already exists`);
        }
        this.logger.warn(`Failed to insert order into DB: ${err}. Falling back to memory.`);
      }
    }

    this.mockOrders.set(orderHash.toLowerCase(), storedOrder);
    this.bookSequence++;
    return storedOrder;
  }

  async getOrderBook(
    chainId: number,
    seriesAddress: string,
    claimType: 'UPSIDE' | 'RESIDUAL',
  ): Promise<UpsideOrderBookDepth> {
    const normSeries = seriesAddress.toLowerCase();
    const nowSecs = Math.floor(Date.now() / 1000);

    let orders: UpsideStoredOrderModel[] = [];

    if (this.db) {
      try {
        const query = `
          SELECT * FROM upside_orders
          WHERE chain_id = $1 AND LOWER(series_address) = $2 AND claim_type = $3
            AND is_locally_hidden = false AND order_status = 'FILLABLE'
            AND expiry_timestamp > $4
          ORDER BY price_usd_e6 DESC, created_at ASC
        `;
        const res = await this.db.query(query, [chainId, normSeries, claimType, nowSecs]);
        if (res?.rows) {
          orders = res.rows.map((r: any) => this.mapOrderRow(r));
        }
      } catch (err) {
        this.logger.warn(`Failed DB query for orderbook: ${err}`);
      }
    }

    if (orders.length === 0) {
      orders = Array.from(this.mockOrders.values()).filter(
        (o) =>
          o.chainId === chainId &&
          o.seriesAddress.toLowerCase() === normSeries &&
          o.claimType === claimType &&
          !o.isLocallyHidden &&
          o.orderStatus === 'FILLABLE' &&
          o.expiryTimestamp > nowSecs,
      );
    }

    // Bids (BUY side): sorted descending by price
    const rawBids = orders.filter((o) => o.side === 'BUY').sort((a, b) => (BigInt(a.priceUsdE6) > BigInt(b.priceUsdE6) ? -1 : 1));
    // Asks (SELL side): sorted ascending by price
    const rawAsks = orders.filter((o) => o.side === 'SELL').sort((a, b) => (BigInt(a.priceUsdE6) < BigInt(b.priceUsdE6) ? -1 : 1));

    const bids = this.aggregateLevels(rawBids, 'BUY');
    const asks = this.aggregateLevels(rawAsks, 'SELL');

    const recentTrades = this.mockTrades.get(`${chainId}:${normSeries}:${claimType}`) || [];

    return {
      seriesAddress: getAddress(seriesAddress),
      claimType,
      claimToken: orders[0]?.claimToken || '0x0000000000000000000000000000000000000000',
      quoteToken: BASE_USDC_ADDRESS,
      sequence: this.bookSequence,
      asOfBlock: 0,
      bids,
      asks,
      recentTrades,
    };
  }

  async getUserOrders(chainId: number, owner: string): Promise<UpsideStoredOrderModel[]> {
    const normOwner = owner.toLowerCase();

    if (this.db) {
      try {
        const query = `
          SELECT * FROM upside_orders
          WHERE chain_id = $1 AND LOWER(maker_address) = $2
          ORDER BY created_at DESC
        `;
        const res = await this.db.query(query, [chainId, normOwner]);
        if (res?.rows) {
          return res.rows.map((r: any) => this.mapOrderRow(r));
        }
      } catch (err) {
        this.logger.warn(`Failed DB query for user orders: ${err}`);
      }
    }

    return Array.from(this.mockOrders.values()).filter(
      (o) => o.chainId === chainId && o.makerAddress.toLowerCase() === normOwner,
    );
  }

  async cancelOrderIntent(orderHash: string, userAddress: string): Promise<UpsideCancelIntentResponse> {
    const normHash = orderHash.toLowerCase();
    const normUser = userAddress.toLowerCase();

    let order = this.mockOrders.get(normHash);

    if (this.db) {
      try {
        const res = await this.db.query(
          `SELECT * FROM upside_orders WHERE LOWER(order_hash) = $1`,
          [normHash],
        );
        if (res?.rows?.[0]) {
          order = this.mapOrderRow(res.rows[0]);
        }
      } catch (err) {
        this.logger.warn(`Failed DB query for order ${orderHash}: ${err}`);
      }
    }

    if (!order) {
      throw new NotFoundException(`Order ${orderHash} not found`);
    }

    if (order.makerAddress.toLowerCase() !== normUser) {
      throw new UnauthorizedException('Only the order maker can cancel this order');
    }

    // Locally hide the order
    order.isLocallyHidden = true;
    order.orderStatus = 'LOCALLY_HIDDEN';

    if (this.db) {
      try {
        await this.db.query(
          `UPDATE upside_orders
           SET is_locally_hidden = true, order_status = 'LOCALLY_HIDDEN', updated_at = NOW()
           WHERE LOWER(order_hash) = $1`,
          [normHash],
        );
      } catch (err) {
        this.logger.warn(`Failed to update order status in DB: ${err}`);
      }
    }

    const upsideLimitOrder: UpsideLimitOrder = {
      makerToken: order.makerToken as `0x${string}`,
      takerToken: order.takerToken as `0x${string}`,
      makerAmount: order.makerAmount,
      takerAmount: order.takerAmount,
      maker: order.makerAddress as `0x${string}`,
      taker: order.takerAddress as `0x${string}`,
      pool: '0x0000000000000000000000000000000000000000000000000000000000000000',
      expiry: order.expiryTimestamp.toString(),
      salt: order.salt,
      feeRecipient: '0x0000000000000000000000000000000000000000',
      takerTokenFeeAmount: '0',
      sender: '0x0000000000000000000000000000000000000000',
    };

    const encodedData = encodeFunctionData({
      abi: ZERO_EX_LIMIT_ORDER_ABI,
      functionName: 'cancelLimitOrder',
      args: [
        {
          makerToken: upsideLimitOrder.makerToken,
          takerToken: upsideLimitOrder.takerToken,
          makerAmount: BigInt(upsideLimitOrder.makerAmount),
          takerAmount: BigInt(upsideLimitOrder.takerAmount),
          takerTokenFeeAmount: 0n,
          maker: upsideLimitOrder.maker,
          taker: upsideLimitOrder.taker,
          sender: upsideLimitOrder.sender,
          feeRecipient: upsideLimitOrder.feeRecipient,
          pool: upsideLimitOrder.pool,
          expiry: BigInt(upsideLimitOrder.expiry),
          salt: BigInt(upsideLimitOrder.salt),
        },
      ],
    });

    this.bookSequence++;
    return {
      orderHash,
      status: 'LOCALLY_HIDDEN',
      cancelTransactionData: {
        to: ZERO_EX_EXCHANGE_PROXY_BASE,
        data: encodedData,
      },
    };
  }

  /**
   * Multi-level sweep quote:
   * BUY: Taker wants to BUY claims -> Sweeps resting ASKS (makers selling claims) sorted ascending by price.
   * SELL: Taker wants to SELL claims -> Sweeps resting BIDS (makers buying claims) sorted descending by price.
   */
  async getSweepQuote(
    chainId: number,
    seriesAddress: string,
    req: UpsideSweepQuoteRequest,
    routerAddress?: `0x${string}`,
  ): Promise<UpsideSweepQuoteResponse> {
    const { claimType, side, requestedUnits, takerAddress } = req;
    const requestedUnitsBig = BigInt(requestedUnits);

    if (requestedUnitsBig <= 0n) {
      throw new BadRequestException('Requested units must be positive');
    }

    const nowSecs = Math.floor(Date.now() / 1000);
    const depth = await this.getOrderBook(chainId, seriesAddress, claimType);

    // If BUY, we sweep ASKS (resting orders where makers sell claims)
    // If SELL, we sweep BIDS (resting orders where makers buy claims)
    const targetSide = side === 'BUY' ? 'SELL' : 'BUY';

    let orders: UpsideStoredOrderModel[] = Array.from(this.mockOrders.values()).filter(
      (o) =>
        o.chainId === chainId &&
        o.seriesAddress.toLowerCase() === seriesAddress.toLowerCase() &&
        o.claimType === claimType &&
        o.side === targetSide &&
        !o.isLocallyHidden &&
        o.orderStatus === 'FILLABLE' &&
        o.expiryTimestamp > nowSecs,
    );

    if (this.db) {
      try {
        const res = await this.db.query(
          `SELECT * FROM upside_orders
           WHERE chain_id = $1 AND LOWER(series_address) = $2 AND claim_type = $3 AND side = $4
             AND is_locally_hidden = false AND order_status = 'FILLABLE' AND expiry_timestamp > $5
           ORDER BY ${targetSide === 'SELL' ? 'price_usd_e6 ASC' : 'price_usd_e6 DESC'}, created_at ASC`,
          [chainId, seriesAddress.toLowerCase(), claimType, targetSide, nowSecs],
        );
        if (res?.rows) {
          orders = res.rows.map((r: any) => this.mapOrderRow(r));
        }
      } catch (err) {
        this.logger.warn(`Failed DB query for sweep quote orders: ${err}`);
      }
    }

    // Sort: if sweeping asks (BUY), sort ascending; if sweeping bids (SELL), sort descending
    if (side === 'BUY') {
      orders.sort((a, b) => (BigInt(a.priceUsdE6) < BigInt(b.priceUsdE6) ? -1 : 1));
    } else {
      orders.sort((a, b) => (BigInt(a.priceUsdE6) > BigInt(b.priceUsdE6) ? -1 : 1));
    }

    let remainingUnitsToFill = requestedUnitsBig;
    let totalCostUsdcBig = 0n;
    const sweepLevels: UpsideSweepQuoteLevel[] = [];
    const sweepOrders: UpsideLimitOrder[] = [];
    const sweepSignatures: UpsideSignature[] = [];
    const takerTokenFillAmounts: bigint[] = [];

    const claimDecimals = 8;

    for (const ord of orders) {
      if (remainingUnitsToFill <= 0n) break;

      // Available claim units on this order
      let availableUnitsOnOrder: bigint;
      if (ord.side === 'SELL') {
        // Maker sells remainingMakerAmount claims
        availableUnitsOnOrder = BigInt(ord.remainingMakerAmount);
      } else {
        // Maker buys remainingTakerAmount claims
        availableUnitsOnOrder = BigInt(ord.remainingTakerAmount);
      }

      if (availableUnitsOnOrder <= 0n) continue;

      const fillUnits = availableUnitsOnOrder < remainingUnitsToFill ? availableUnitsOnOrder : remainingUnitsToFill;
      const unitPriceUsdc = Number(ord.priceUsdE6) / 1e6;

      // Calculate fill cost in USDC (6 decimals)
      // cost = fillUnits * unitPrice
      let costUsdcBig: bigint;
      let takerFillAmountFor0x: bigint;

      if (ord.side === 'SELL') {
        // Taker gives USDC to 0x. takerToken is USDC.
        // takerTokenFillAmount = (fillUnits * takerAmount) / makerAmount
        takerFillAmountFor0x = (fillUnits * BigInt(ord.takerAmount)) / BigInt(ord.makerAmount);
        costUsdcBig = takerFillAmountFor0x;
      } else {
        // Taker gives claims to 0x. takerToken is claimToken.
        takerFillAmountFor0x = fillUnits;
        // Taker receives USDC: (fillUnits * makerAmount) / takerAmount
        costUsdcBig = (fillUnits * BigInt(ord.makerAmount)) / BigInt(ord.takerAmount);
      }

      totalCostUsdcBig += costUsdcBig;
      remainingUnitsToFill -= fillUnits;

      sweepLevels.push({
        orderHash: ord.orderHash as `0x${string}`,
        maker: ord.makerAddress as `0x${string}`,
        unitPriceUsdc,
        claimUnits: fillUnits.toString(),
        usdcCost: costUsdcBig.toString(),
      });

      sweepOrders.push({
        makerToken: ord.makerToken as `0x${string}`,
        takerToken: ord.takerToken as `0x${string}`,
        makerAmount: ord.makerAmount,
        takerAmount: ord.takerAmount,
        maker: ord.makerAddress as `0x${string}`,
        taker: ord.takerAddress as `0x${string}`,
        pool: '0x0000000000000000000000000000000000000000000000000000000000000000',
        expiry: ord.expiryTimestamp.toString(),
        salt: ord.salt,
        feeRecipient: '0x0000000000000000000000000000000000000000',
        takerTokenFeeAmount: '0',
        sender: '0x0000000000000000000000000000000000000000',
      });

      sweepSignatures.push(ord.signature);
      takerTokenFillAmounts.push(takerFillAmountFor0x);
    }

    const executedUnitsBig = requestedUnitsBig - remainingUnitsToFill;
    const averagePriceUsdc = executedUnitsBig > 0n
      ? Number(totalCostUsdcBig) / (Number(executedUnitsBig) / (10 ** (claimDecimals - 6))) / 1e6
      : 0;

    let transactionData: `0x${string}` | undefined;
    let targetTo: `0x${string}` | undefined;

    if (sweepOrders.length === 1 && !routerAddress) {
      // Single order fill directly on 0x ExchangeProxy
      targetTo = ZERO_EX_EXCHANGE_PROXY_BASE;
      transactionData = encodeFunctionData({
        abi: ZERO_EX_LIMIT_ORDER_ABI,
        functionName: 'fillLimitOrder',
        args: [
          {
            makerToken: sweepOrders[0].makerToken,
            takerToken: sweepOrders[0].takerToken,
            makerAmount: BigInt(sweepOrders[0].makerAmount),
            takerAmount: BigInt(sweepOrders[0].takerAmount),
            takerTokenFeeAmount: 0n,
            maker: sweepOrders[0].maker,
            taker: sweepOrders[0].taker,
            sender: sweepOrders[0].sender,
            feeRecipient: sweepOrders[0].feeRecipient,
            pool: sweepOrders[0].pool,
            expiry: BigInt(sweepOrders[0].expiry),
            salt: BigInt(sweepOrders[0].salt),
          },
          sweepSignatures[0],
          takerTokenFillAmounts[0],
        ],
      });
    } else if (sweepOrders.length > 0 && routerAddress) {
      // Multi-level batch fill via UpsideBatchFillRouter
      targetTo = routerAddress;
      transactionData = encodeFunctionData({
        abi: UPSIDE_BATCH_FILL_ROUTER_ABI,
        functionName: 'batchFillLimitOrders',
        args: [
          sweepOrders.map((o) => ({
            makerToken: o.makerToken,
            takerToken: o.takerToken,
            makerAmount: BigInt(o.makerAmount),
            takerAmount: BigInt(o.takerAmount),
            takerTokenFeeAmount: 0n,
            maker: o.maker,
            taker: o.taker,
            sender: o.sender,
            feeRecipient: o.feeRecipient,
            pool: o.pool,
            expiry: BigInt(o.expiry),
            salt: BigInt(o.salt),
          })),
          sweepSignatures,
          takerTokenFillAmounts,
          true, // revertIfIncomplete
        ],
      });
    }

    return {
      seriesAddress: getAddress(seriesAddress),
      claimType,
      side,
      requestedUnits,
      executableUnits: executedUnitsBig.toString(),
      totalCostUsdc: totalCostUsdcBig.toString(),
      averagePriceUsdc,
      levels: sweepLevels,
      quoteExpiry: nowSecs + 60, // 60 seconds validity
      bookSequence: this.bookSequence,
      orders: sweepOrders,
      signatures: sweepSignatures,
      takerTokenFillAmounts: takerTokenFillAmounts.map((a) => a.toString()),
      revertIfIncomplete: true,
      transactionData,
      to: targetTo,
      value: '0',
    };
  }

  private aggregateLevels(orders: UpsideStoredOrderModel[], side: 'BUY' | 'SELL'): UpsideOrderBookLevel[] {
    const levelMap = new Map<string, { amountClaim: bigint; orderCount: number; orderHash?: string }>();

    for (const ord of orders) {
      const priceKey = ord.priceUsdE6;
      const existing = levelMap.get(priceKey) || { amountClaim: 0n, orderCount: 0 };

      const claimAmount = ord.side === 'SELL' ? BigInt(ord.remainingMakerAmount) : BigInt(ord.remainingTakerAmount);
      existing.amountClaim += claimAmount;
      existing.orderCount += 1;
      if (!existing.orderHash) existing.orderHash = ord.orderHash;

      levelMap.set(priceKey, existing);
    }

    let runningTotal = 0n;
    const levels: UpsideOrderBookLevel[] = [];

    for (const [rawPriceE6, data] of levelMap.entries()) {
      runningTotal += data.amountClaim;
      levels.push({
        priceUsd: (Number(rawPriceE6) / 1e6).toFixed(4),
        rawPriceE6,
        amountClaim: data.amountClaim.toString(),
        totalClaim: runningTotal.toString(),
        orderCount: data.orderCount,
        orderHash: data.orderHash,
      });
    }

    return levels;
  }

  private mapOrderRow(row: any): UpsideStoredOrderModel {
    return {
      orderHash: row.order_hash.trim(),
      chainId: Number(row.chain_id),
      seriesAddress: row.series_address.trim(),
      claimType: row.claim_type.trim(),
      claimToken: row.claim_token.trim(),
      quoteToken: row.quote_token.trim(),
      side: row.side.trim(),
      makerAddress: row.maker_address.trim(),
      takerAddress: row.taker_address.trim(),
      makerToken: row.maker_token.trim(),
      takerToken: row.taker_token.trim(),
      makerAmount: row.maker_amount.toString(),
      takerAmount: row.taker_amount.toString(),
      remainingMakerAmount: row.remaining_maker_amount.toString(),
      remainingTakerAmount: row.remaining_taker_amount.toString(),
      priceUsdE6: row.price_usd_e6.toString(),
      priceFormatted: (Number(row.price_usd_e6) / 1e6).toFixed(4),
      expiryTimestamp: Number(row.expiry_timestamp),
      salt: row.salt.toString(),
      verifyingContract: row.verifying_contract.trim(),
      signature: typeof row.signature === 'string' ? JSON.parse(row.signature) : row.signature,
      orderStatus: row.order_status.trim(),
      isLocallyHidden: Boolean(row.is_locally_hidden),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
