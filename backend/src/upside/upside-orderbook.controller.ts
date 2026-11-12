import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { UpsideOrderbookService } from './upside-orderbook.service';
import { CreateUpsideOrderDto } from './upside-orderbook.types';
import { UpsideSweepQuoteRequest } from '@othelio/shared';

@Controller('v1/upside')
export class UpsideOrderbookController {
  constructor(private readonly orderbookService: UpsideOrderbookService) {}

  @Get('markets/:series/book')
  async getOrderBook(
    @Param('series') series: string,
    @Query('chainId') chainId?: string,
    @Query('claimType') claimType?: 'UPSIDE' | 'RESIDUAL',
  ) {
    const selectedClaim = claimType || 'UPSIDE';
    return this.orderbookService.getOrderBook(
      chainId ? Number(chainId) : 8453,
      series,
      selectedClaim,
    );
  }

  @Post('orders')
  async createOrder(@Body() body: CreateUpsideOrderDto) {
    if (!body || !body.order || !body.signature) {
      throw new BadRequestException('Order body must contain order and signature');
    }
    const chainId = body.chainId || 8453;
    return this.orderbookService.createOrder(chainId, body);
  }

  @Get('orders')
  async getUserOrders(
    @Query('owner') owner: string,
    @Query('chainId') chainId?: string,
  ) {
    if (!owner) {
      throw new BadRequestException('Query parameter "owner" is required');
    }
    return this.orderbookService.getUserOrders(
      chainId ? Number(chainId) : 8453,
      owner,
    );
  }

  @Post('orders/:orderHash/cancel-intent')
  async cancelOrderIntent(
    @Param('orderHash') orderHash: string,
    @Body('userAddress') userAddress: string,
  ) {
    if (!userAddress) {
      throw new BadRequestException('Body parameter "userAddress" is required');
    }
    return this.orderbookService.cancelOrderIntent(orderHash, userAddress);
  }

  @Post('markets/:series/sweep-quote')
  async getSweepQuote(
    @Param('series') series: string,
    @Body() body: UpsideSweepQuoteRequest,
    @Query('chainId') chainId?: string,
    @Query('routerAddress') routerAddress?: string,
  ) {
    if (!body.requestedUnits || !body.claimType || !body.side) {
      throw new BadRequestException('claimType, side, and requestedUnits are required');
    }
    return this.orderbookService.getSweepQuote(
      chainId ? Number(chainId) : 8453,
      series,
      body,
      routerAddress as `0x${string}` | undefined,
    );
  }
}
