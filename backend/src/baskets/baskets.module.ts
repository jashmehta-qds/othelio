import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DexModule } from '../dex/dex.module';
import { BasketsController } from './baskets.controller';
import { BasketQuotePlannerService } from './basket-quote-planner.service';
import { BasketsService } from './baskets.service';
import { LendingEventService } from './lending-event.service';
import { LendingReceiptReconciliationService } from './lending-receipt-reconciliation.service';
import { BasketPositionService } from './basket-position.service';

@Module({
  imports: [DatabaseModule, DexModule],
  controllers: [BasketsController],
  providers: [BasketsService, BasketPositionService, BasketQuotePlannerService, LendingEventService, LendingReceiptReconciliationService],
  exports: [BasketPositionService, BasketQuotePlannerService, LendingEventService, LendingReceiptReconciliationService],
})
export class BasketsModule {}
