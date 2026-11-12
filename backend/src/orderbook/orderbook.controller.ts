import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { OrderbookService } from './orderbook.service';
import { BuildFillTxRequest, CreateOrderRequest, OrderBookDepth, StoredOrderModel } from './orderbook.types';

@Controller()
export class OrderbookController {
  constructor(private readonly orderbookService: OrderbookService) {}

  @Get('v1/risksplit/series/:seriesAddress/books/:claim')
  async getBook(
    @Param('seriesAddress') seriesAddress: string,
    @Param('claim') claim: string,
    @Query('chainId') chainId?: string
  ): Promise<OrderBookDepth> {
    const claimTypeUpper = claim.toUpperCase();
    if (claimTypeUpper !== 'PROTECTED' && claimTypeUpper !== 'UPSIDE') {
      throw new BadRequestException(`Invalid claim type ${claim}. Must be 'protected' or 'upside'`);
    }

    return this.orderbookService.getOrderBook(
      seriesAddress,
      claimTypeUpper as 'PROTECTED' | 'UPSIDE',
      chainId ? Number(chainId) : 8453
    );
  }

  @Post('v1/orders')
  async createOrder(@Body() body: CreateOrderRequest): Promise<StoredOrderModel> {
    return this.orderbookService.validateAndStoreOrder(body);
  }

  @Get('v1/orders')
  async getOwnerOrders(
    @Query('owner') owner: string,
    @Query('chainId') chainId?: string
  ): Promise<StoredOrderModel[]> {
    if (!owner) {
      throw new BadRequestException('Query parameter "owner" is required');
    }
    return this.orderbookService.getOwnerOrders(owner, chainId ? Number(chainId) : 8453);
  }

  @Post('v1/orders/:hash/cancel-intent')
  async cancelIntent(
    @Param('hash') hash: string,
    @Body() body: { userAddress: string }
  ) {
    if (!body?.userAddress) {
      throw new BadRequestException('Body parameter "userAddress" is required');
    }
    return this.orderbookService.cancelOrderIntent(hash, body.userAddress);
  }

  @Post('v1/orders/:hash/build-fill')
  async buildFill(
    @Param('hash') hash: string,
    @Body() body: BuildFillTxRequest,
    @Query('chainId') chainId?: string
  ) {
    return this.orderbookService.buildFillTransaction(hash, body, chainId ? Number(chainId) : 8453);
  }

  @Post('v1/orders/:hash/reconcile-fill')
  async reconcileFill(@Param('hash') hash: string, @Body() body: { txHash: string }) {
    if (!body?.txHash) throw new BadRequestException('Body parameter "txHash" is required');
    return this.orderbookService.reconcileFillTransaction(hash, body.txHash);
  }
}
