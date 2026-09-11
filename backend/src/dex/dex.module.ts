import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ZeroXAdapter } from './adapters/zero-x.adapter';
import { OneInchAdapter } from './adapters/one-inch.adapter';
import { AerodromeAdapter } from './adapters/aerodrome.adapter';
import { FallbackAdapter } from './adapters/fallback.adapter';
import { LocalAnvilAdapter } from './adapters/local-anvil.adapter';
import { DexManagerService } from './dex-manager.service';
import { DexController } from './dex.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [DexController],
  providers: [
    ZeroXAdapter,
    OneInchAdapter,
    AerodromeAdapter,
    LocalAnvilAdapter,
    FallbackAdapter,
    DexManagerService,
  ],
  exports: [DexManagerService],
})
export class DexModule {}
