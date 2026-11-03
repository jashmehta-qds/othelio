import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminOverviewService } from './admin-overview.service';
import { AdminGuard } from '../auth/admin.guard';
import { AdminOverviewResponse } from '@othelio/shared';

@Controller('v1/admin/overview')
@UseGuards(AdminGuard)
export class AdminOverviewController {
  constructor(private readonly overviewService: AdminOverviewService) {}

  @Get()
  async getOverview(@Query('chainId') chainId?: string): Promise<AdminOverviewResponse> {
    return this.overviewService.getOverview(chainId ? Number(chainId) : 8453);
  }
}
