import { Body, Controller, Delete, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { BasketsService } from './baskets.service';
import { BasketPositionService } from './basket-position.service';
import { LendingReceiptReconciliationService } from './lending-receipt-reconciliation.service';

@Controller('v1/baskets')
export class BasketsController {
  constructor(
    @Inject(BasketsService)
    private readonly basketsService: BasketsService,
    @Inject(BasketPositionService)
    private readonly basketPositions: BasketPositionService,
    @Inject(LendingReceiptReconciliationService)
    private readonly lendingReconciliation: LendingReceiptReconciliationService,
  ) {}

  @Delete('reset')
  async resetAllBaskets() {
    return this.basketsService.clearAllBaskets();
  }

  @Post('reset')
  async resetAllBasketsPost() {
    return this.basketsService.clearAllBaskets();
  }

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

  @Get(':address/positions')
  async getBasketPositions(
    @Param('address') address: string,
    @Query('chainId') chainId: string,
  ) {
    return this.basketPositions.getPositionSnapshot(address, chainId);
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

  @Post('create-seed-quote')
  async quoteCreateSeed(@Body() body: import('./basket-quote-planner.service').CreateSeedQuoteRequest) {
    return this.basketsService.quoteCreateSeed(body);
  }

  @Post(':address/lending-log')
  async recordLendingLog(
    @Param('address') address: string,
    @Body() body: any,
  ) {
    return this.basketsService.recordLendingEvent({
      ...body,
      basketAddress: address,
    });
  }

  /** On-demand bounded reconciliation; this endpoint does not imply a scheduler. */
  @Post(':address/lending-log/:txHash/reconcile')
  async reconcileLendingLog(
    @Param('address') address: string,
    @Param('txHash') txHash: string,
    @Query('chainId') chainId: string,
  ) {
    return this.lendingReconciliation.reconcile(Number(chainId), txHash, address);
  }
}
