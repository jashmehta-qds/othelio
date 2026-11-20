import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminMarketsService } from './admin-markets.service';
import { AdminChain, AdminGuard, RequireAdminOwner } from '../auth/admin.guard';
import {
  AdminMarketPreviewRequest,
  AdminMarketPreviewResponse,
  AdminMarketsResponse,
  AdminRiskSplitSetupRequest,
  AdminRiskSplitSetupResponse,
} from '@othelio/shared';

@Controller('v1/admin/markets')
@UseGuards(AdminGuard)
export class AdminMarketsController {
  constructor(private readonly marketsService: AdminMarketsService) {}

  @Get()
  async getMarkets(@AdminChain() chainId: number): Promise<AdminMarketsResponse> {
    return this.marketsService.getMarkets(chainId);
  }

  @Post('preview')
  @RequireAdminOwner('riskSplit')
  async previewMarket(@Body() body: AdminMarketPreviewRequest, @AdminChain() chainId: number): Promise<AdminMarketPreviewResponse> {
    return this.marketsService.previewMarket({ ...body, chainId });
  }

  @Post('setup')
  @RequireAdminOwner('riskSplit')
  async previewSetup(@Body() body: AdminRiskSplitSetupRequest, @AdminChain() chainId: number): Promise<AdminRiskSplitSetupResponse> {
    return this.marketsService.previewSetup({ ...body, chainId });
  }
}
