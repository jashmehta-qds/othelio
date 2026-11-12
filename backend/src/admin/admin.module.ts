import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RiskSplitModule } from '../risksplit/risksplit.module';
import { AdminAuthService } from './auth/admin-auth.service';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminGuard } from './auth/admin.guard';
import { AdminOverviewService } from './overview/admin-overview.service';
import { AdminOverviewController } from './overview/admin-overview.controller';
import { AdminAssetsService } from './assets/admin-assets.service';
import { AdminAssetsController } from './assets/admin-assets.controller';
import { AdminMarketsService } from './markets/admin-markets.service';
import { AdminMarketsController } from './markets/admin-markets.controller';
import { AdminOperationsService } from './operations/admin-operations.service';
import { AdminOperationsController } from './operations/admin-operations.controller';
import { AdminUpsideService } from './upside/admin-upside.service';
import { AdminUpsideController } from './upside/admin-upside.controller';

@Module({
  imports: [DatabaseModule, RiskSplitModule],
  controllers: [
    AdminAuthController,
    AdminOverviewController,
    AdminAssetsController,
    AdminMarketsController,
    AdminOperationsController,
    AdminUpsideController,
  ],
  providers: [
    AdminAuthService,
    AdminGuard,
    AdminOverviewService,
    AdminAssetsService,
    AdminMarketsService,
    AdminOperationsService,
    AdminUpsideService,
  ],
  exports: [AdminAuthService, AdminGuard],
})
export class AdminModule {}
