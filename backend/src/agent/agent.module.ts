import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { BasketsModule } from '../baskets/baskets.module';
import { AgentController } from './agent.controller';
import { ProposalsController } from './proposals.controller';
import { AgentSettingsService } from './agent-settings.service';
import { AgentProposalsService } from './agent-proposals.service';
import { AgentGuard } from './agent.guard';

@Module({
  imports: [DatabaseModule, BasketsModule],
  controllers: [AgentController, ProposalsController],
  providers: [AgentSettingsService, AgentProposalsService, AgentGuard],
  exports: [AgentSettingsService, AgentProposalsService],
})
export class AgentModule {}
