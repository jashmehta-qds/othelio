import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { UpsideService } from './upside.service';

@Controller('v1/upside')
export class UpsideController {
  constructor(private readonly upsideService: UpsideService) {}

  @Get('assets')
  async getAssets(@Query('chainId') chainId?: string) {
    return this.upsideService.getAssets(chainId ? Number(chainId) : 8453);
  }

  @Get('rounds')
  async getRounds(
    @Query('chainId') chainId?: string,
    @Query('underlying') underlying?: string,
  ) {
    return this.upsideService.getRounds(
      chainId ? Number(chainId) : 8453,
      underlying,
    );
  }

  @Get('markets')
  async getMarkets(
    @Query('chainId') chainId?: string,
    @Query('roundId') roundId?: string,
    @Query('underlying') underlying?: string,
  ) {
    return this.upsideService.getMarkets(
      chainId ? Number(chainId) : 8453,
      roundId !== undefined ? Number(roundId) : undefined,
      underlying,
    );
  }

  @Get('markets/:series')
  async getMarketDetail(
    @Param('series') series: string,
    @Query('chainId') chainId?: string,
  ) {
    const market = await this.upsideService.getMarket(
      chainId ? Number(chainId) : 8453,
      series,
    );
    if (!market) {
      throw new NotFoundException(`Upside market ${series} not found`);
    }
    return market;
  }

  @Get('positions/:wallet')
  async getUserPositions(
    @Param('wallet') wallet: string,
    @Query('chainId') chainId?: string,
  ) {
    return this.upsideService.getUserPositions(
      chainId ? Number(chainId) : 8453,
      wallet,
    );
  }

  @Get('stocks/:asset/history')
  async getStockHistory(
    @Param('asset') asset: string,
    @Query('chainId') chainId?: string,
  ) {
    return this.upsideService.getStockHistory(
      chainId ? Number(chainId) : 8453,
      asset,
    );
  }
}
