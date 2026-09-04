import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { BasketsModule } from './baskets/baskets.module.js';
import { PrepareModule } from './prepare/prepare.module.js';

@Module({
  imports: [DatabaseModule, BasketsModule, PrepareModule],
})
export class AppModule {}
