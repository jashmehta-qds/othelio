import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { BasketsModule } from './baskets/baskets.module';
import { PrepareModule } from './prepare/prepare.module';

@Module({
  imports: [DatabaseModule, BasketsModule, PrepareModule],
})
export class AppModule {}
