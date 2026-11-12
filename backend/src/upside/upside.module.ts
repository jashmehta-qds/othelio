import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UpsideService } from './upside.service';
import { UpsideController } from './upside.controller';
import { UpsideOrderbookService } from './upside-orderbook.service';
import { UpsideOrderbookController } from './upside-orderbook.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [UpsideController, UpsideOrderbookController],
  providers: [UpsideService, UpsideOrderbookService],
  exports: [UpsideService, UpsideOrderbookService],
})
export class UpsideModule {}
