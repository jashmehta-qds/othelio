import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { LendingController } from './lending.controller';
import { LendingManagerService } from './lending-manager.service';
import { AaveV3LendingAdapter } from './adapters/aave-v3.adapter';

@Module({
  imports: [DatabaseModule],
  controllers: [LendingController],
  providers: [
    LendingManagerService,
    AaveV3LendingAdapter,
  ],
  exports: [LendingManagerService],
})
export class LendingModule {}
