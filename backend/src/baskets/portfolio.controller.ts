import { Controller, Get, Inject, Query, Param } from '@nestjs/common';
import { BasketsService } from './baskets.service';

/** Controller-scoped read models. All methods are database projections and do not use RPC. */
@Controller('v1')
export class PortfolioController {
  constructor(
    @Inject(BasketsService)
    private readonly baskets: BasketsService,
  ) {}

  @Get('portfolio/overview')
  async getOverview(@Query('chainId') chainId: string, @Query('controller') controller: string) {
    return { data: await this.baskets.getPortfolioOverview(chainId, controller) };
  }

  @Get('assets')
  getAssets(@Query('chainId') chainId?: string) {
    return this.baskets.getAssets(chainId);
  }

  @Get('activity')
  getActivity(
    @Query('chainId') chainId: string,
    @Query('controller') controller: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.baskets.getControllerActivity(chainId, controller, cursor, limit);
  }

  @Get('baskets/:address/activity')
  getBasketActivity(
    @Param('address') address: string,
    @Query('chainId') chainId: string,
    @Query('controller') controller: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.baskets.getBasketActivityPage(address, chainId, controller, cursor, limit);
  }
}
