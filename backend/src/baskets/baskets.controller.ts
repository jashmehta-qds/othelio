import { Controller, Get, Param, Query } from '@nestjs/common';
import { BasketsService } from './baskets.service.js';

@Controller('v1/baskets')
export class BasketsController {
  constructor(private readonly basketsService: BasketsService) {}

  @Get()
  async getBaskets(
    @Query('chainId') chainId: string,
    @Query('controller') controller?: string,
  ) {
    return this.basketsService.getBaskets(chainId, controller);
  }

  @Get(':address')
  async getBasketByAddress(
    @Param('address') address: string,
    @Query('chainId') chainId: string,
  ) {
    return this.basketsService.getBasketByAddress(address, chainId);
  }

  @Get(':address/activity')
  async getBasketActivity(
    @Param('address') address: string,
    @Query('chainId') chainId: string,
  ) {
    return this.basketsService.getBasketActivity(address, chainId);
  }
}
