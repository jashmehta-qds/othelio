import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { BasketsModule } from './baskets/baskets.module';
import { PrepareModule } from './prepare/prepare.module';
import { DexModule } from './dex/dex.module';
import { LendingModule } from './lending/lending.module';
import { SettingsModule } from './settings/settings.module';
import { AuthModule } from './auth/auth.module';
import { AgentModule } from './agent/agent.module';
import { RiskSplitModule } from './risksplit/risksplit.module';
import { AdminModule } from './admin/admin.module';
import { OrderbookModule } from './orderbook/orderbook.module';
import { UpsideModule } from './upside/upside.module';
import { HealthController } from './health.controller';

@Module({
  imports: [DatabaseModule, BasketsModule, PrepareModule, DexModule, LendingModule, SettingsModule, AuthModule, AgentModule, RiskSplitModule, AdminModule, OrderbookModule, UpsideModule],
  controllers: [HealthController],
})
export class AppModule {}
