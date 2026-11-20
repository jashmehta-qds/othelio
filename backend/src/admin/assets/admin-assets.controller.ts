import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminAssetsService } from './admin-assets.service';
import { AdminChain, AdminGuard, RequireAdminOwner } from '../auth/admin.guard';
import { AdminAssetsResponse, AdminTransactionPreview } from '@othelio/shared';

@Controller('v1/admin/assets')
@UseGuards(AdminGuard)
export class AdminAssetsController {
  constructor(private readonly assetsService: AdminAssetsService) {}

  @Get()
  async getAssets(@AdminChain() chainId: number): Promise<AdminAssetsResponse> {
    return this.assetsService.getAssets(chainId);
  }

  @Post('preview-enable')
  @RequireAdminOwner('assetRegistry')
  async previewEnable(@Body() body: { assetAddress: string }, @AdminChain() chainId: number): Promise<AdminTransactionPreview[]> {
    return this.assetsService.previewEnableAsset(body.assetAddress, chainId);
  }
}
