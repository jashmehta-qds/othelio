import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminOperationsService } from './admin-operations.service';
import { AdminGuard } from '../auth/admin.guard';
import { AdminOperationsResponse } from '@othelio/shared';

@Controller('v1/admin/operations')
@UseGuards(AdminGuard)
export class AdminOperationsController {
  constructor(private readonly operationsService: AdminOperationsService) {}

  @Get()
  async getOperations(@Query('chainId') chainId?: string): Promise<AdminOperationsResponse> {
    return this.operationsService.getOperations(chainId ? Number(chainId) : 8453);
  }
}
