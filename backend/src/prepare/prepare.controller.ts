import { Body, Controller, Param, Post } from '@nestjs/common';
import { PrepareService } from './prepare.service.js';

@Controller('v1/prepare')
export class PrepareController {
  constructor(private readonly prepareService: PrepareService) {}

  @Post(':operation')
  async prepareOperation(
    @Param('operation') operation: string,
    @Body() body: any,
  ) {
    return this.prepareService.prepareOperation(operation, body);
  }
}
