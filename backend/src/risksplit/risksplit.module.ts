import { Module } from '@nestjs/common';
import { RiskSplitService } from './risksplit.service';
import { RiskSplitController } from './risksplit.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [RiskSplitController],
  providers: [RiskSplitService],
  exports: [RiskSplitService],
})
export class RiskSplitModule {}
