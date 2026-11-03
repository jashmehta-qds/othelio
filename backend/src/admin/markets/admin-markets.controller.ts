import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminMarketsService } from './admin-markets.service';
import { AdminGuard } from '../auth/admin.guard';
import {
  AdminMarketPreviewRequest,
  AdminMarketPreviewResponse,
  AdminMarketsResponse,
} from '@othelio/shared';

@Controller('v1/admin/markets')
@UseGuards(AdminGuard)
export class AdminMarketsController {
  constructor(private readonly marketsService: AdminMarketsService) {}

  @Get()
  async getMarkets(@Query('chainId') chainId?: string): Promise<AdminMarketsResponse> {
    return this.marketsService.getMarkets(chainId ? Number(chainId) : 8453);
  }

  @Post('preview')
  async previewMarket(@Body() body: AdminMarketPreviewRequest): Promise<AdminMarketPreviewResponse> {
    return this.marketsService.previewMarket(body);
  }
}
