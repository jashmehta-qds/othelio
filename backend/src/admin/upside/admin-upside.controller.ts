import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { AdminUpsideService } from './admin-upside.service';
import {
  AdminUpsideRoundPreviewRequest,
  AdminUpsideRoundPreviewResponse,
  AdminUpsideRoundItem,
  AdminUpsideMarketItem,
  AdminTransactionPreview,
} from '@othelio/shared';

@Controller('v1/admin/upside')
@UseGuards(AdminGuard)
export class AdminUpsideController {
  constructor(private readonly upsideService: AdminUpsideService) {}

  @Post('rounds/preview')
  async previewRound(@Body() dto: AdminUpsideRoundPreviewRequest): Promise<AdminUpsideRoundPreviewResponse> {
    return this.upsideService.previewRound(dto);
  }

  @Get('rounds')
  async getRounds(@Query('chainId') chainId?: string): Promise<{ data: AdminUpsideRoundItem[] }> {
    const chainIdNum = chainId ? parseInt(chainId, 10) : 8453;
    const data = await this.upsideService.getRounds(chainIdNum);
    return { data };
  }

  @Get('markets')
  async getMarkets(
    @Query('chainId') chainId?: string,
    @Query('roundId') roundId?: string,
  ): Promise<{ data: AdminUpsideMarketItem[] }> {
    const chainIdNum = chainId ? parseInt(chainId, 10) : 8453;
    const roundIdNum = roundId ? parseInt(roundId, 10) : undefined;
    const data = await this.upsideService.getMarkets(chainIdNum, roundIdNum);
    return { data };
  }

  @Post('rounds/toggle-public')
  async togglePublicCreation(
    @Body() dto: { chainId?: number; roundId: number; enabled: boolean },
  ): Promise<AdminTransactionPreview> {
    return this.upsideService.togglePublicCreationTx(dto.chainId || 8453, dto.roundId, dto.enabled);
  }
}
