import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminOverviewService } from './admin-overview.service';
import { AdminChain, AdminGuard } from '../auth/admin.guard';
import { AdminOverviewResponse } from '@othelio/shared';

@Controller('v1/admin/overview')
@UseGuards(AdminGuard)
export class AdminOverviewController {
  constructor(private readonly overviewService: AdminOverviewService) {}

  @Get()
  async getOverview(@AdminChain() chainId: number): Promise<AdminOverviewResponse> {
    return this.overviewService.getOverview(chainId);
  }
}
