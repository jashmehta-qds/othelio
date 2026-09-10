import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { BasketsModule } from './baskets/baskets.module';
import { PrepareModule } from './prepare/prepare.module';
import { DexModule } from './dex/dex.module';
import { LendingModule } from './lending/lending.module';

@Module({
  imports: [DatabaseModule, BasketsModule, PrepareModule, DexModule, LendingModule],
})
export class AppModule {}
