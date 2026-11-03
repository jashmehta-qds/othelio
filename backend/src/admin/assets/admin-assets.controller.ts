import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminAssetsService } from './admin-assets.service';
import { AdminGuard } from '../auth/admin.guard';
import { AdminAssetsResponse, AdminTransactionPreview } from '@othelio/shared';

@Controller('v1/admin/assets')
@UseGuards(AdminGuard)
export class AdminAssetsController {
  constructor(private readonly assetsService: AdminAssetsService) {}

  @Get()
  async getAssets(@Query('chainId') chainId?: string): Promise<AdminAssetsResponse> {
    return this.assetsService.getAssets(chainId ? Number(chainId) : 8453);
  }

  @Post('preview-enable')
  async previewEnable(@Body() body: { assetAddress: string; chainId?: number }): Promise<AdminTransactionPreview[]> {
    return this.assetsService.previewEnableAsset(body.assetAddress, body.chainId);
  }
}
