import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { LendingManagerService } from './lending-manager.service';
import { LendingQuoteParams } from './interfaces/lending-adapter.interface';

@Controller('v1/lending')
export class LendingController {
  constructor(
    @Inject(LendingManagerService)
    private readonly lendingManagerService: LendingManagerService,
  ) {}

  @Post('quote')
  async getLendingQuote(@Body() body: LendingQuoteParams) {
    return this.lendingManagerService.getBestLendingQuote(body);
  }

  @Post('basket-breakdown')
  async getBasketLendingBreakdown(@Body() body: { chainId?: number; assets: Array<{ address: string; amount?: string }> }) {
    const chainId = body.chainId ?? 31337;
    return this.lendingManagerService.getBasketLendingBreakdown(chainId, body.assets || []);
  }

  @Get('adapters')
  async getAdapters() {
    return {
      success: true,
      adapters: this.lendingManagerService.getRegisteredAdapters(),
    };
  }

  @Get('summary')
  async getPortfolioSummary(
    @Query('chainId') chainId?: string,
    @Query('bufferPct') bufferPct?: string,
  ) {
    const chain = chainId ? parseInt(chainId, 10) : 31337;
    const buf = bufferPct ? parseFloat(bufferPct) : 30.0;
    return this.lendingManagerService.getPortfolioSummary(chain, buf);
  }
}
