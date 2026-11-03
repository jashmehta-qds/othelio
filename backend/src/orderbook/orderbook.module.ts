import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RiskSplitModule } from '../risksplit/risksplit.module';
import { OrderbookService } from './orderbook.service';
import { OrderbookController } from './orderbook.controller';

@Module({
  imports: [DatabaseModule, RiskSplitModule],
  controllers: [OrderbookController],
  providers: [OrderbookService],
  exports: [OrderbookService],
})
export class OrderbookModule {}
