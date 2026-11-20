import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminChain, AdminGuard, RequireAdminOwner } from '../auth/admin.guard';
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
  @RequireAdminOwner('upside')
  async previewRound(@Body() dto: AdminUpsideRoundPreviewRequest, @AdminChain() chainId: number): Promise<AdminUpsideRoundPreviewResponse> {
    return this.upsideService.previewRound({ ...dto, chainId });
  }

  @Get('rounds')
  async getRounds(@AdminChain() chainId: number): Promise<{ data: AdminUpsideRoundItem[] }> {
    const data = await this.upsideService.getRounds(chainId);
    return { data };
  }

  @Get('markets')
  async getMarkets(
    @AdminChain() chainId: number,
    @Query('roundId') roundId?: string,
  ): Promise<{ data: AdminUpsideMarketItem[] }> {
    const roundIdNum = roundId ? parseInt(roundId, 10) : undefined;
    const data = await this.upsideService.getMarkets(chainId, roundIdNum);
    return { data };
  }

  @Post('rounds/toggle-public')
  @RequireAdminOwner('upside')
  async togglePublicCreation(
    @Body() dto: { chainId?: number; roundId: number; enabled: boolean },
    @AdminChain() chainId: number,
  ): Promise<AdminTransactionPreview> {
    return this.upsideService.togglePublicCreationTx(chainId, dto.roundId, dto.enabled);
  }
}
