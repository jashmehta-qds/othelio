import { Module } from '@nestjs/common';
import { PrepareController } from './prepare.controller';
import { PrepareService } from './prepare.service';

@Module({
  controllers: [PrepareController],
  providers: [PrepareService],
})
export class PrepareModule {}
