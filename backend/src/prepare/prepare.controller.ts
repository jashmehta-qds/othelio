import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { PrepareService } from './prepare.service';

@Controller('v1/prepare')
export class PrepareController {
  constructor(
    @Inject(PrepareService)
    private readonly prepareService: PrepareService,
  ) {}

  @Post(':operation')
  async prepareOperation(
    @Param('operation') operation: string,
    @Body() body: any,
  ) {
    return this.prepareService.prepareOperation(operation, body);
  }
}
