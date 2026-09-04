import { Module } from '@nestjs/common';
import { PrepareController } from './prepare.controller.js';
import { PrepareService } from './prepare.service.js';

@Module({
  controllers: [PrepareController],
  providers: [PrepareService],
})
export class PrepareModule {}
