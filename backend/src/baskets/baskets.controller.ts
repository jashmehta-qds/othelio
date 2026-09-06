import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { BasketsService } from './baskets.service';

@Controller('v1/baskets')
export class BasketsController {
  constructor(
    @Inject(BasketsService)
    private readonly basketsService: BasketsService,
  ) {}

  @Get()
  async getBaskets(
    @Query('chainId') chainId: string,
    @Query('controller') controller?: string,
  ) {
    return this.basketsService.getBaskets(chainId, controller);
  }

  @Post()
  async createBasket(@Body() body: any) {
    return this.basketsService.createBasket(body);
  }

  @Get('activity/all')
  async getAllActivity(@Query('chainId') chainId: string) {
    return this.basketsService.getAllActivity(chainId);
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

  @Get('assets/supported')
  async getSupportedAssets() {
    return this.basketsService.getAssets();
  }

  @Post(':address/quote-swaps')
  async quoteSwaps(
    @Param('address') address: string,
    @Body() body: any,
  ) {
    return this.basketsService.quoteSwaps(address, body);
  }
}
