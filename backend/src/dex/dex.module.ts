import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AerodromeAdapter } from './adapters/aerodrome.adapter';
import { DexManagerService } from './dex-manager.service';
import { DexController } from './dex.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [DexController],
  providers: [
    AerodromeAdapter,
    DexManagerService,
  ],
  exports: [DexManagerService],
})
export class DexModule {}
