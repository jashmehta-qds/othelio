import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminOperationsService } from './admin-operations.service';
import { AdminChain, AdminGuard } from '../auth/admin.guard';
import { AdminOperationsResponse } from '@othelio/shared';

@Controller('v1/admin/operations')
@UseGuards(AdminGuard)
export class AdminOperationsController {
  constructor(private readonly operationsService: AdminOperationsService) {}

  @Get()
  async getOperations(@AdminChain() chainId: number): Promise<AdminOperationsResponse> {
    return this.operationsService.getOperations(chainId);
  }
}
