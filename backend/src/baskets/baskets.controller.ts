import { Body, Controller, Delete, ForbiddenException, Get, Header, Inject, Param, Post, Query } from '@nestjs/common';
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
    if (process.env.NODE_ENV === 'production') throw new ForbiddenException({ error: 'RESET_DISABLED_IN_PRODUCTION' });
    return this.basketsService.clearAllBaskets();
  }

  @Post('reset')
  async resetAllBasketsPost() {
    if (process.env.NODE_ENV === 'production') throw new ForbiddenException({ error: 'RESET_DISABLED_IN_PRODUCTION' });
    return this.basketsService.clearAllBaskets();
  }

  @Get()
  async getBaskets(
    @Query('chainId') chainId: string,
    @Query('controller') controller: string,
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

  @Get('valuation-history')
  async getValuationHistory(
    @Query('chainId') chainId: string,
    @Query('controller') controller: string,
    @Query('timeframe') timeframe?: string,
  ) {
    return this.basketsService.getValuationHistory(chainId, controller, timeframe);
  }

  @Get(':address/accounting-summary')
  async getAccountingSummary(
    @Param('address') address: string,
    @Query('chainId') chainId: string,
    @Query('controller') controller: string,
  ) {
    return this.basketsService.getAccountingSummary(address, chainId, controller);
  }

  @Get(':address/accounting-events')
  async getAccountingEvents(
    @Param('address') address: string,
    @Query('chainId') chainId: string,
    @Query('controller') controller: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.basketsService.getAccountingEvents(address, chainId, controller, cursor, limit);
  }

  @Get(':address/accounting-export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async getAccountingExport(
    @Param('address') address: string,
    @Query('chainId') chainId: string,
    @Query('controller') controller: string,
  ) {
    return this.basketsService.getAccountingCsv(address, chainId, controller);
  }

  @Get(':address')
  async getBasketByAddress(
    @Param('address') address: string,
    @Query('chainId') chainId: string,
    @Query('controller') controller?: string,
  ) {
    return this.basketsService.getBasketDetail(address, chainId, controller);
  }

  @Get(':address/positions')
  async getBasketPositions(
    @Param('address') address: string,
    @Query('chainId') chainId: string,
  ) {
    return this.basketPositions.getIndexedPositionSnapshot(address, chainId);
  }

  @Get('assets/supported')
  async getSupportedAssets(@Query('chainId') chainId?: string) {
    return this.basketsService.getAssets(chainId);
  }

  @Post(':address/quote-swaps')
  async quoteSwaps(
    @Param('address') address: string,
    @Body() body: any,
  ) {
    return this.basketsService.quoteSwaps(address, body);
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
