import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { BasketsModule } from './baskets/baskets.module';
import { PrepareModule } from './prepare/prepare.module';
import { DexModule } from './dex/dex.module';
import { LendingModule } from './lending/lending.module';
import { SettingsModule } from './settings/settings.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [DatabaseModule, BasketsModule, PrepareModule, DexModule, LendingModule, SettingsModule, AuthModule],
})
export class AppModule {}
