import { Controller, Get, Inject, Query } from '@nestjs/common';
import { DexManagerService } from './dex-manager.service';

@Controller('v1/dex')
export class DexController {
  constructor(
    @Inject(DexManagerService)
    private readonly dexManagerService: DexManagerService,
  ) {}

  @Get('providers')
  getProviders() {
    return {
      success: true,
      data: this.dexManagerService.getRegisteredAdapters(),
    };
  }

  @Get('route-history')
  async getRouteHistory(@Query('basketAddress') basketAddress?: string) {
    return this.dexManagerService.getRouteHistory(basketAddress);
  }
}
