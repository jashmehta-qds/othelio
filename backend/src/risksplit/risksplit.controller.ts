import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { RiskSplitService } from './risksplit.service';

@Controller('v1/risksplit')
export class RiskSplitController {
  constructor(private readonly riskSplitService: RiskSplitService) {}

  @Get('series')
  async getSeriesList(
    @Query('chainId') chainIdQuery?: string,
    @Query('underlying') underlying?: string
  ) {
    const chainId = chainIdQuery ? parseInt(chainIdQuery, 10) : 8453;
    return this.riskSplitService.getSeriesList(chainId, underlying);
  }

  @Get('series/:seriesAddress')
  async getSeries(
    @Param('seriesAddress') seriesAddress: string,
    @Query('chainId') chainIdQuery?: string
  ) {
    const chainId = chainIdQuery ? parseInt(chainIdQuery, 10) : 8453;
    const series = await this.riskSplitService.getSeries(chainId, seriesAddress);
    if (!series) {
      throw new NotFoundException(`Series ${seriesAddress} not found`);
    }
    return series;
  }

  @Get('series/:seriesAddress/payoff')
  async getPayoff(
    @Param('seriesAddress') seriesAddress: string,
    @Query('chainId') chainIdQuery?: string,
    @Query('maxPrice') maxPriceQuery?: string
  ) {
    const chainId = chainIdQuery ? parseInt(chainIdQuery, 10) : 8453;
    const maxPrice = maxPriceQuery ? parseFloat(maxPriceQuery) : undefined;
    const payoff = await this.riskSplitService.getPayoffCurve(chainId, seriesAddress, maxPrice);
    if (!payoff) {
      throw new NotFoundException(`Series ${seriesAddress} not found`);
    }
    return payoff;
  }

  @Get('series/:seriesAddress/positions/:userAddress')
  async getUserPositions(
    @Param('seriesAddress') seriesAddress: string,
    @Param('userAddress') userAddress: string,
    @Query('chainId') chainIdQuery?: string
  ) {
    const chainId = chainIdQuery ? parseInt(chainIdQuery, 10) : 8453;
    return this.riskSplitService.getUserPositions(chainId, seriesAddress, userAddress);
  }

  @Get('series/:seriesAddress/quote')
  async getQuote(
    @Param('seriesAddress') seriesAddress: string,
    @Query('action') action: string,
    @Query('amount') amount: string,
    @Query('chainId') chainIdQuery?: string
  ) {
    if (!action || !amount) {
      throw new BadRequestException('action and amount parameters are required');
    }
    const chainId = chainIdQuery ? parseInt(chainIdQuery, 10) : 8453;
    const quote = await this.riskSplitService.getQuote(chainId, seriesAddress, action, amount);
    if (!quote.isExecutable && quote.reason === 'SERIES_NOT_FOUND') {
      throw new NotFoundException(`Series ${seriesAddress} not found`);
    }
    return quote;
  }
}
