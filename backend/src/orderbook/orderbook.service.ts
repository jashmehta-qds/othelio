import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RiskSplitService } from '../risksplit/risksplit.service';
import {
  BASE_CHAIN_ID,
  BASE_FORK_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  ZERO_EX_EIP712_DOMAIN,
  ZERO_EX_EXCHANGE_PROXY_BASE,
  ZERO_EX_LIMIT_ORDER_ABI,
  OrderStatus,
  LIMIT_ORDER_EIP712_TYPES,
  ZeroExLimitOrder,
  ZeroExSignature,
  buildCancelLimitOrderTx,
  buildFillLimitOrderTx,
  toZeroExAbiOrder,
} from '@othelio/shared';
import {
  createPublicClient,
  decodeEventLog,
  formatUnits,
  getAddress,
  hashTypedData,
  http,
  isAddress,
  parseAbi,
  verifyTypedData,
} from 'viem';
import { rpcUrlForChain } from '../config/network-runtime';
import { BASE_USDC_ADDRESS } from '../config/addresses';
import {
  BuildFillTxRequest,
  CreateOrderRequest,
  OrderBookDepth,
  OrderBookLevel,
  OrderBookTrade,
  StoredOrderModel,
} from './orderbook.types';

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

@Injectable()
export class OrderbookService {
  private readonly logger = new Logger(OrderbookService.name);
  private bookSequence = 1;

  constructor(
    @Optional() private readonly db?: DatabaseService,
    @Optional() private readonly riskSplitService?: RiskSplitService,
  ) {}

  private createVenueClient(chainId: number) {
    const rpcUrl = rpcUrlForChain(chainId);
    if (!rpcUrl) throw new ServiceUnavailableException('Chain RPC unavailable for order verification');
    return createPublicClient({ transport: http(rpcUrl) });
  }

  private async getClaimDecimals(chainId: number, claimToken: string): Promise<number> {
    const raw = await this.createVenueClient(chainId).readContract({
      address: getAddress(claimToken),
      abi: ERC20_ABI,
      functionName: 'decimals',
    });
    const decimals = Number(raw);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw new BadRequestException('Unsupported claim token decimals');
    }
    return decimals;
  }

  private orderFromRow(row: any): ZeroExLimitOrder {
    return {
      makerToken: row.maker_token,
      takerToken: row.taker_token,
      makerAmount: row.maker_amount,
      takerAmount: row.taker_amount,
      takerTokenFeeAmount: '0',
      maker: row.maker_address,
      taker: row.taker_address,
      sender: '0x0000000000000000000000000000000000000000',
      feeRecipient: '0x0000000000000000000000000000000000000000',
      pool: '0x0000000000000000000000000000000000000000000000000000000000000000',
      expiry: Number(row.expiry_timestamp),
      salt: row.salt,
    };
  }

  computeOrderHash(order: ZeroExLimitOrder, _chainId: number = BASE_CHAIN_ID): `0x${string}` {
    // The fork uses Base's already-deployed 0x proxy, whose cached EIP-712
    // domain separator remains bound to Base chain ID 8453.
    const domain = ZERO_EX_EIP712_DOMAIN;

    return hashTypedData({
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
  }

  async validateAndStoreOrder(req: CreateOrderRequest): Promise<StoredOrderModel> {
    const { order, signature, chainId, seriesAddress, claimType } = req;
    const zeroAddress = '0x0000000000000000000000000000000000000000';
    const zeroPool = '0x0000000000000000000000000000000000000000000000000000000000000000';

    // 1. Chain validation
    if (chainId !== BASE_MAINNET_CHAIN_ID && chainId !== BASE_FORK_CHAIN_ID) {
      throw new BadRequestException(`Unsupported chain ID: ${chainId}`);
    }
    if (!isAddress(seriesAddress) || (claimType !== 'PROTECTED' && claimType !== 'UPSIDE')) {
      throw new BadRequestException('Invalid series or claim type');
    }
    if (order.takerTokenFeeAmount !== '0' ||
        order.taker.toLowerCase() !== zeroAddress ||
        order.sender.toLowerCase() !== zeroAddress ||
        order.feeRecipient.toLowerCase() !== zeroAddress ||
        order.pool.toLowerCase() !== zeroPool ||
        signature.signatureType !== 2) {
      throw new BadRequestException('Public book requires unrestricted zero-fee 0x limit orders');
    }

    // 2. Expiry checks
    const nowSecs = Math.floor(Date.now() / 1000);
    const orderExpiry = Number(order.expiry);
    if (orderExpiry <= nowSecs) {
      throw new BadRequestException('Order has already expired');
    }

    // 3. Series validation
    const series = this.riskSplitService
      ? await this.riskSplitService.getSeries(chainId, seriesAddress)
      : null;

    if (!series && this.db) {
      throw new NotFoundException(`Risk Split series ${seriesAddress} not found`);
    }

    if (series) {
      if (series.isSettled) {
        throw new BadRequestException('Cannot place order on settled series');
      }
      if (orderExpiry > series.expiryTimestamp) {
        throw new BadRequestException('Order expiry cannot exceed series expiry');
      }
    }

    // 4. Claim and Pair validation
    const expectedClaimToken =
      claimType === 'PROTECTED'
        ? series?.protectedTokenAddress?.toLowerCase()
        : series?.upsideTokenAddress?.toLowerCase();

    const makerToken = order.makerToken.toLowerCase();
    const takerToken = order.takerToken.toLowerCase();
    const usdcAddr = BASE_USDC_ADDRESS.toLowerCase();

    let side: 'BUY' | 'SELL';
    let claimTokenAddr: string;

    if (makerToken === usdcAddr) {
      // Maker offering USDC to BUY Claim Token
      side = 'BUY';
      claimTokenAddr = takerToken;
      if (expectedClaimToken && takerToken !== expectedClaimToken) {
        throw new BadRequestException(`Taker token ${takerToken} does not match series ${claimType} claim token`);
      }
    } else if (takerToken === usdcAddr) {
      // Maker offering Claim Token to SELL for USDC
      side = 'SELL';
      claimTokenAddr = makerToken;
      if (expectedClaimToken && makerToken !== expectedClaimToken) {
        throw new BadRequestException(`Maker token ${makerToken} does not match series ${claimType} claim token`);
      }
    } else {
      throw new BadRequestException('One side of the order pair must be USDC');
    }

    // 5. Amount validation
    const makerAmountBig = BigInt(order.makerAmount);
    const takerAmountBig = BigInt(order.takerAmount);
    if (makerAmountBig <= 0n || takerAmountBig <= 0n) {
      throw new BadRequestException('Maker and taker amounts must be strictly positive');
    }

    // Price in 6-decimal USDC per one whole claim token.
    const claimDecimals = await this.getClaimDecimals(chainId, claimTokenAddr);
    const claimUnit = 10n ** BigInt(claimDecimals);
    let priceUsdE6Big: bigint;
    if (side === 'BUY') {
      priceUsdE6Big = (makerAmountBig * claimUnit) / takerAmountBig;
    } else {
      priceUsdE6Big = (takerAmountBig * claimUnit) / makerAmountBig;
    }

    if (priceUsdE6Big <= 0n) {
      throw new BadRequestException('Calculated price is zero or invalid');
    }

    // 7. Cryptographic EIP-712 Signature check
    const domain = ZERO_EX_EIP712_DOMAIN;

    let isSigValid = false;
    try {
      isSigValid = await verifyTypedData({
        address: getAddress(order.maker),
        domain,
        types: LIMIT_ORDER_EIP712_TYPES,
        primaryType: 'LimitOrder',
        message: {
          makerToken: getAddress(order.makerToken),
          takerToken: getAddress(order.takerToken),
          makerAmount: makerAmountBig,
          takerAmount: takerAmountBig,
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
          r: signature.r as `0x${string}`,
          s: signature.s as `0x${string}`,
          v: BigInt(signature.v),
        },
      });
    } catch (err) {
      this.logger.warn(`Signature verification error: ${err}`);
      isSigValid = false;
    }

    if (!isSigValid) {
      throw new UnauthorizedException('Invalid EIP-712 cryptographic signature for 0x order');
    }

    const orderHash = this.computeOrderHash(order, chainId);

    // 8. Replay check
    if (this.db) {
      const existing = await this.db.query(
        'SELECT order_hash FROM risk_split_orders WHERE order_hash = $1',
        [orderHash]
      );
      if (existing.rows && existing.rows.length > 0) {
        throw new BadRequestException('Nonce replay rejected: Order hash already exists');
      }
    }

    // 9. Onchain balance and allowance verification
    const rpcUrl = rpcUrlForChain(chainId);
    if (rpcUrl && process.env.NODE_ENV !== 'test') {
      try {
        const client = createPublicClient({ transport: http(rpcUrl) });
        const [balance, allowance] = await Promise.all([
          client.readContract({
            address: getAddress(order.makerToken),
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [getAddress(order.maker)],
          }),
          client.readContract({
            address: getAddress(order.makerToken),
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [getAddress(order.maker), ZERO_EX_EXCHANGE_PROXY_BASE],
          }),
        ]);

        if (balance < makerAmountBig) {
          throw new BadRequestException('Maker has insufficient token balance for order amount');
        }
        if (allowance < makerAmountBig) {
          throw new BadRequestException('Maker has insufficient allowance for 0x ExchangeProxy');
        }
      } catch (err: any) {
        if (err instanceof BadRequestException) throw err;
        this.logger.warn(`Could not verify onchain balance/allowance: ${err}`);
        throw new ServiceUnavailableException('Could not verify maker balance and allowance');
      }
    }

    // 10. Persist order
    if (this.db) {
      await this.db.query(
        `INSERT INTO risk_split_orders (
           order_hash, chain_id, series_address, claim_type, claim_token, quote_token,
           side, maker_address, taker_address, maker_token, taker_token,
           maker_amount, taker_amount, remaining_maker_amount, remaining_taker_amount,
           price_usd_e6, expiry_timestamp, salt, verifying_contract, signature,
           order_status, is_locally_hidden, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 'FILLABLE', false, NOW(), NOW()
         )`,
        [
          orderHash,
          chainId,
          seriesAddress.toLowerCase(),
          claimType,
          claimTokenAddr,
          usdcAddr,
          side,
          order.maker.toLowerCase(),
          (order.taker || '0x0000000000000000000000000000000000000000').toLowerCase(),
          makerToken,
          takerToken,
          makerAmountBig.toString(),
          takerAmountBig.toString(),
          makerAmountBig.toString(),
          takerAmountBig.toString(),
          priceUsdE6Big.toString(),
          orderExpiry,
          order.salt,
          ZERO_EX_EXCHANGE_PROXY_BASE.toLowerCase(),
          JSON.stringify(signature),
        ]
      );
    }

    this.bookSequence += 1;

    return {
      orderHash,
      chainId,
      seriesAddress: seriesAddress.toLowerCase(),
      claimType,
      claimToken: claimTokenAddr,
      quoteToken: usdcAddr,
      side,
      makerAddress: order.maker.toLowerCase(),
      takerAddress: (order.taker || '0x0000000000000000000000000000000000000000').toLowerCase(),
      makerToken,
      takerToken,
      makerAmount: makerAmountBig.toString(),
      takerAmount: takerAmountBig.toString(),
      remainingMakerAmount: makerAmountBig.toString(),
      remainingTakerAmount: takerAmountBig.toString(),
      priceUsdE6: priceUsdE6Big.toString(),
      priceFormatted: `$${(Number(priceUsdE6Big) / 1e6).toFixed(4)}`,
      expiryTimestamp: orderExpiry,
      salt: order.salt,
      verifyingContract: ZERO_EX_EXCHANGE_PROXY_BASE,
      signature,
      orderStatus: 'FILLABLE',
      isLocallyHidden: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async getOrderBook(
    seriesAddress: string,
    claimType: 'PROTECTED' | 'UPSIDE',
    chainIdInput = 8453
  ): Promise<OrderBookDepth> {
    const chainId = Number(chainIdInput);
    const normSeries = seriesAddress.toLowerCase();

    if (!this.riskSplitService || !this.db) {
      throw new ServiceUnavailableException('Live market state unavailable');
    }
    const freshness = await this.riskSplitService.getIndexerFreshness(chainId);
    if (!freshness.isFresh) {
      throw new ServiceUnavailableException('Risk Split indexer is stale');
    }
    const asOfBlock = freshness.lastIndexedBlock;

    const series = await this.riskSplitService.getSeries(chainId, normSeries);
    if (!series) throw new NotFoundException(`Risk Split series ${normSeries} not found`);

    const claimToken =
      claimType === 'PROTECTED'
        ? series?.protectedTokenAddress || '0x0000000000000000000000000000000000000000'
        : series?.upsideTokenAddress || '0x0000000000000000000000000000000000000000';

    const bids: OrderBookLevel[] = [];
    const asks: OrderBookLevel[] = [];
    const recentTrades: OrderBookTrade[] = [];

    if (!series.isSettled && series.expiryTimestamp > Math.floor(Date.now() / 1000)) {
      try {
        const claimDecimals = await this.getClaimDecimals(chainId, claimToken);
        const nowSecs = Math.floor(Date.now() / 1000);

        // Fetch fillable orders
        const ordersRes = await this.db.query(
          `SELECT * FROM risk_split_orders
           WHERE chain_id = $1 AND LOWER(series_address) = $2 AND claim_type = $3
             AND order_status = 'FILLABLE' AND NOT is_locally_hidden
             AND expiry_timestamp > $4
           ORDER BY side,
             CASE WHEN side = 'BUY' THEN price_usd_e6 END DESC,
             CASE WHEN side = 'SELL' THEN price_usd_e6 END ASC,
             created_at ASC`,
          [chainId, normSeries, claimType, nowSecs]
        );

        // Group into depth levels
        const bidLevels = new Map<string, { priceUsdE6: bigint; amountClaim: bigint; count: number; orderHash: string }>();
        const askLevels = new Map<string, { priceUsdE6: bigint; amountClaim: bigint; count: number; orderHash: string }>();

        const client = this.createVenueClient(chainId);
        const reservedMakerFunds = new Map<string, bigint>();
        for (const row of ordersRes.rows || []) {
          const order = this.orderFromRow(row);
          const onchain = await client.readContract({
            address: ZERO_EX_EXCHANGE_PROXY_BASE,
            abi: ZERO_EX_LIMIT_ORDER_ABI,
            functionName: 'getLimitOrderInfo',
            args: [toZeroExAbiOrder(order)],
          });
          if (Number(onchain.status) !== OrderStatus.FILLABLE || onchain.orderHash.toLowerCase() !== row.order_hash.toLowerCase()) continue;
          const remainingTaker = BigInt(row.taker_amount) - BigInt(onchain.takerTokenFilledAmount);
          if (remainingTaker <= 0n) continue;
          const remainingMaker = (BigInt(row.maker_amount) * remainingTaker + BigInt(row.taker_amount) - 1n) / BigInt(row.taker_amount);
          const makerKey = `${row.maker_address.toLowerCase()}:${row.maker_token.toLowerCase()}`;
          let available = reservedMakerFunds.get(makerKey);
          if (available === undefined) {
            const [balance, allowance] = await Promise.all([
              client.readContract({ address: getAddress(row.maker_token), abi: ERC20_ABI, functionName: 'balanceOf', args: [getAddress(row.maker_address)] }),
              client.readContract({ address: getAddress(row.maker_token), abi: ERC20_ABI, functionName: 'allowance', args: [getAddress(row.maker_address), ZERO_EX_EXCHANGE_PROXY_BASE] }),
            ]);
            available = balance < allowance ? balance : allowance;
          }
          if (available < remainingMaker) {
            reservedMakerFunds.set(makerKey, available);
            continue;
          }
          reservedMakerFunds.set(makerKey, available - remainingMaker);
          const side = row.side;
          const priceE6 = BigInt(row.price_usd_e6);
          const priceKey = priceE6.toString();

          // Claim amount
          // BUY: maker is USDC, taker is Claim -> claim amount is remaining_taker_amount
          // SELL: maker is Claim, taker is USDC -> claim amount is remaining_maker_amount
          const claimAmt =
            side === 'BUY'
              ? remainingTaker
              : remainingMaker;

          const targetMap = side === 'BUY' ? bidLevels : askLevels;
          const existing = targetMap.get(priceKey);
          if (existing) {
            existing.amountClaim += claimAmt;
            existing.count += 1;
          } else {
            targetMap.set(priceKey, {
              priceUsdE6: priceE6,
              amountClaim: claimAmt,
              count: 1,
              orderHash: row.order_hash,
            });
          }
        }

        // Cumulative sum for bids
        let runningBidTotal = 0n;
        for (const lvl of bidLevels.values()) {
          runningBidTotal += lvl.amountClaim;
          bids.push({
            priceUsd: `$${(Number(lvl.priceUsdE6) / 1e6).toFixed(4)}`,
            rawPriceE6: lvl.priceUsdE6.toString(),
            amountClaim: Number(formatUnits(lvl.amountClaim, claimDecimals)).toFixed(4),
            totalClaim: Number(formatUnits(runningBidTotal, claimDecimals)).toFixed(4),
            orderCount: lvl.count,
            orderHash: lvl.orderHash,
          });
        }

        // Cumulative sum for asks
        let runningAskTotal = 0n;
        for (const lvl of askLevels.values()) {
          runningAskTotal += lvl.amountClaim;
          asks.push({
            priceUsd: `$${(Number(lvl.priceUsdE6) / 1e6).toFixed(4)}`,
            rawPriceE6: lvl.priceUsdE6.toString(),
            amountClaim: Number(formatUnits(lvl.amountClaim, claimDecimals)).toFixed(4),
            totalClaim: Number(formatUnits(runningAskTotal, claimDecimals)).toFixed(4),
            orderCount: lvl.count,
            orderHash: lvl.orderHash,
          });
        }

        // Fetch recent trades
        const tradesRes = await this.db.query(
          `SELECT * FROM risk_split_trades
           WHERE chain_id = $1 AND LOWER(series_address) = $2 AND claim_type = $3
           ORDER BY occurred_at DESC LIMIT 50`,
          [chainId, normSeries, claimType]
        );

        for (const row of tradesRes.rows || []) {
          const side = row.side;
          const claimAmt = side === 'BUY' ? row.fill_taker_amount : row.fill_maker_amount;
          const usdcAmt = side === 'BUY' ? row.fill_maker_amount : row.fill_taker_amount;

          recentTrades.push({
            id: row.id.toString(),
            orderHash: row.order_hash,
            side: row.side,
            amountClaim: Number(formatUnits(BigInt(claimAmt), claimDecimals)).toFixed(4),
            amountUsdc: `$${(Number(usdcAmt) / 1e6).toFixed(2)}`,
            priceUsd: `$${(Number(row.price_usd_e6) / 1e6).toFixed(4)}`,
            txHash: row.tx_hash || null,
            occurredAt: new Date(row.occurred_at).toISOString(),
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to construct orderbook: ${err}`);
        throw new ServiceUnavailableException('Could not verify executable order book');
      }
    }

    return {
      seriesAddress: normSeries,
      claimType,
      claimToken,
      quoteToken: BASE_USDC_ADDRESS,
      sequence: this.bookSequence,
      asOfBlock,
      bids,
      asks,
      recentTrades,
    };
  }

  async buildFillTransaction(
    orderHash: string,
    req: BuildFillTxRequest,
    chainIdInput = 8453
  ) {
    const chainId = Number(chainIdInput);

    if (!this.db) {
      throw new BadRequestException('Database unavailable');
    }

    const res = await this.db.query(
      'SELECT * FROM risk_split_orders WHERE order_hash = $1',
      [orderHash]
    );

    if (!res.rows || res.rows.length === 0) {
      throw new NotFoundException(`Order ${orderHash} not found`);
    }

    const row = res.rows[0];

    if (Number(row.chain_id) !== chainId) {
      throw new BadRequestException('Order chain does not match requested chain');
    }
    if (row.order_status !== 'FILLABLE' || row.is_locally_hidden) {
      throw new BadRequestException(`Order is not fillable (current status: ${row.order_status})`);
    }
    if (Number(row.expiry_timestamp) <= Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('Order has expired');
    }
    const freshness = await this.riskSplitService?.getIndexerFreshness(chainId);
    if (!freshness?.isFresh) throw new ServiceUnavailableException('Risk Split indexer is stale');
    const series = await this.riskSplitService?.getSeries(chainId, row.series_address);
    if (!series || series.isSettled || series.expiryTimestamp <= Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('Series is no longer open');
    }

    if (req.takerAddress && row.maker_address.toLowerCase() === req.takerAddress.toLowerCase()) {
      throw new BadRequestException('Self-match rejected: Maker and taker cannot be the same address');
    }

    const fillAmountBig = BigInt(req.takerTokenFillAmount);
    const remTakerBig = BigInt(row.remaining_taker_amount);

    if (fillAmountBig <= 0n) {
      throw new BadRequestException('Fill amount must be positive');
    }

    if (fillAmountBig > remTakerBig) {
      throw new BadRequestException(`Requested fill amount exceeds remaining fillable amount (${remTakerBig})`);
    }

    const order = this.orderFromRow(row);
    try {
      const client = this.createVenueClient(chainId);
      const [info, balance, allowance] = await Promise.all([
        client.readContract({ address: ZERO_EX_EXCHANGE_PROXY_BASE, abi: ZERO_EX_LIMIT_ORDER_ABI, functionName: 'getLimitOrderInfo', args: [toZeroExAbiOrder(order)] }),
        client.readContract({ address: getAddress(order.makerToken), abi: ERC20_ABI, functionName: 'balanceOf', args: [getAddress(order.maker)] }),
        client.readContract({ address: getAddress(order.makerToken), abi: ERC20_ABI, functionName: 'allowance', args: [getAddress(order.maker), ZERO_EX_EXCHANGE_PROXY_BASE] }),
      ]);
      if (Number(info.status) !== OrderStatus.FILLABLE || info.orderHash.toLowerCase() !== orderHash.toLowerCase()) {
        throw new BadRequestException('Order is no longer fillable onchain');
      }
      const chainRemaining = BigInt(order.takerAmount) - BigInt(info.takerTokenFilledAmount);
      if (fillAmountBig > chainRemaining) throw new BadRequestException('Fill amount exceeds onchain remaining amount');
      const makerNeeded = (BigInt(order.makerAmount) * fillAmountBig + BigInt(order.takerAmount) - 1n) / BigInt(order.takerAmount);
      if (balance < makerNeeded || allowance < makerNeeded) {
        throw new BadRequestException('Maker balance or allowance is insufficient for fill');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`Could not verify fillability onchain: ${err}`);
      throw new ServiceUnavailableException('Could not verify order fillability');
    }

    const signature: ZeroExSignature =
      typeof row.signature === 'string' ? JSON.parse(row.signature) : row.signature;

    const fillTx = buildFillLimitOrderTx(order, signature, fillAmountBig);

    return {
      description: `Fill Limit Order for ${row.claim_type} Claim on Base`,
      target: fillTx.to,
      method: fillTx.data.functionName,
      args: [order, signature, fillAmountBig.toString()],
      chainId,
      orderHash,
      takerTokenFillAmount: fillAmountBig.toString(),
      priceUsd: `$${(Number(row.price_usd_e6) / 1e6).toFixed(4)}`,
    };
  }

  async cancelOrderIntent(orderHash: string, userAddress: string) {
    if (!this.db) {
      throw new BadRequestException('Database unavailable');
    }

    const res = await this.db.query(
      'SELECT * FROM risk_split_orders WHERE order_hash = $1',
      [orderHash]
    );

    if (!res.rows || res.rows.length === 0) {
      throw new NotFoundException(`Order ${orderHash} not found`);
    }

    const row = res.rows[0];

    if (row.maker_address.toLowerCase() !== userAddress.toLowerCase()) {
      throw new UnauthorizedException('Only the maker can cancel this order');
    }

    // The request body only claims to be the maker. Do not change public book
    // state until the venue confirms cancellation onchain.
    const order = this.orderFromRow(row);

    const cancelTx = buildCancelLimitOrderTx(order);

    return {
      orderHash,
      isLocallyHidden: false,
      cancelTx: {
        description: 'Cancel 0x limit order onchain',
        target: cancelTx.to,
        method: cancelTx.data.functionName,
        args: cancelTx.data.args,
      },
    };
  }

  async getOwnerOrders(ownerAddress: string, chainIdInput = 8453): Promise<StoredOrderModel[]> {
    const chainId = Number(chainIdInput);
    if (!this.db) return [];

    const res = await this.db.query(
      `SELECT * FROM risk_split_orders
       WHERE chain_id = $1 AND LOWER(maker_address) = $2
       ORDER BY created_at DESC`,
      [chainId, ownerAddress.toLowerCase()]
    );

    return (res.rows || []).map((row) => ({
      orderHash: row.order_hash,
      chainId: Number(row.chain_id),
      seriesAddress: row.series_address,
      claimType: row.claim_type,
      claimToken: row.claim_token,
      quoteToken: row.quote_token,
      side: row.side,
      makerAddress: row.maker_address,
      takerAddress: row.taker_address,
      makerToken: row.maker_token,
      takerToken: row.taker_token,
      makerAmount: row.maker_amount,
      takerAmount: row.taker_amount,
      remainingMakerAmount: row.remaining_maker_amount,
      remainingTakerAmount: row.remaining_taker_amount,
      priceUsdE6: row.price_usd_e6,
      priceFormatted: `$${(Number(row.price_usd_e6) / 1e6).toFixed(4)}`,
      expiryTimestamp: Number(row.expiry_timestamp),
      salt: row.salt,
      verifyingContract: row.verifying_contract,
      signature: typeof row.signature === 'string' ? JSON.parse(row.signature) : row.signature,
      orderStatus: row.order_status,
      isLocallyHidden: Boolean(row.is_locally_hidden),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async recordOnchainFill(
    orderHash: string,
    taker: string,
    fillTakerAmount: bigint,
    fillMakerAmount: bigint,
    txHash?: string,
    blockNumber?: number
  ) {
    if (!this.db) return;

    const res = await this.db.query(
      'SELECT * FROM risk_split_orders WHERE order_hash = $1',
      [orderHash]
    );

    if (!res.rows || res.rows.length === 0) return;
    const row = res.rows[0];

    if (txHash) {
      const existingTrade = await this.db.query(
        'SELECT 1 FROM risk_split_trades WHERE order_hash = $1 AND tx_hash = $2 LIMIT 1',
        [orderHash, txHash],
      );
      if (existingTrade.rows?.length) return;
    }

    const remTaker = BigInt(row.remaining_taker_amount) - fillTakerAmount;
    const remMaker = BigInt(row.remaining_maker_amount) - fillMakerAmount;
    const finalRemTaker = remTaker > 0n ? remTaker : 0n;
    const finalRemMaker = remMaker > 0n ? remMaker : 0n;
    const nextStatus = finalRemTaker === 0n ? 'FILLED' : 'FILLABLE';

    await this.db.query(
      `UPDATE risk_split_orders
       SET remaining_taker_amount = $1, remaining_maker_amount = $2,
           order_status = $3, updated_at = NOW()
       WHERE order_hash = $4`,
      [finalRemTaker.toString(), finalRemMaker.toString(), nextStatus, orderHash]
    );

    await this.db.query(
      `INSERT INTO risk_split_trades (
         chain_id, series_address, claim_type, order_hash, maker_address, taker_address,
         side, fill_taker_amount, fill_maker_amount, price_usd_e6, tx_hash, block_number, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
      [
        row.chain_id,
        row.series_address,
        row.claim_type,
        orderHash,
        row.maker_address,
        taker.toLowerCase(),
        row.side,
        fillTakerAmount.toString(),
        fillMakerAmount.toString(),
        row.price_usd_e6,
        txHash || null,
        blockNumber || null,
      ]
    );
  }

  async reconcileFillTransaction(orderHash: string, txHash: string) {
    if (!this.db) throw new BadRequestException('Database unavailable');
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new BadRequestException('Invalid fill transaction hash');

    const res = await this.db.query('SELECT * FROM risk_split_orders WHERE order_hash = $1', [orderHash]);
    if (!res.rows?.length) throw new NotFoundException(`Order ${orderHash} not found`);
    const row = res.rows[0];

    const receipt = await this.createVenueClient(Number(row.chain_id)).getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
    if (receipt.status !== 'success') throw new BadRequestException('Fill transaction reverted');

    let fill: any = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== ZERO_EX_EXCHANGE_PROXY_BASE.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: ZERO_EX_LIMIT_ORDER_ABI, eventName: 'LimitOrderFilled', data: log.data, topics: log.topics });
        if ((decoded.args as any).orderHash.toLowerCase() === orderHash.toLowerCase()) {
          fill = decoded.args;
          break;
        }
      } catch {
        // Ignore unrelated ExchangeProxy logs in the same receipt.
      }
    }
    if (!fill) throw new BadRequestException('Transaction does not contain the requested 0x order fill');

    await this.recordOnchainFill(
      orderHash,
      fill.taker,
      BigInt(fill.takerTokenFilledAmount),
      BigInt(fill.makerTokenFilledAmount),
      txHash,
      Number(receipt.blockNumber),
    );

    return { orderHash, txHash, status: 'RECONCILED' as const };
  }

  async recordOnchainCancel(orderHash: string) {
    if (!this.db) return;
    await this.db.query(
      `UPDATE risk_split_orders
       SET order_status = 'CANCELLED', updated_at = NOW()
       WHERE order_hash = $1`,
      [orderHash]
    );
  }
}
