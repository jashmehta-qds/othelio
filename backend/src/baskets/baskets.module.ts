import { Module } from '@nestjs/common';
import { BasketsController } from './baskets.controller.js';
import { BasketsService } from './baskets.service.js';

@Module({
  controllers: [BasketsController],
  providers: [BasketsService],
})
export class BasketsModule {}
