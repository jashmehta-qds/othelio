import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { AccountSettingsDto, SettingsService } from './settings.service';
import { AgentSettingsService } from '../agent/agent-settings.service';
import { AgentSettingsDto } from '../agent/agent.types';

@Controller('v1/settings')
export class SettingsController {
  constructor(
    @Inject(SettingsService)
    private readonly settingsService: SettingsService,
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(AgentSettingsService)
    private readonly agentSettingsService: AgentSettingsService,
  ) {}

  @Get(':address')
  async getSettings(@Param('address') address: string) {
    const data = await this.settingsService.getAccountSettings(address);
    return {
      success: true,
      data,
    };
  }

  @Put(':address')
  async updateSettings(
    @Param('address') address: string,
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: Partial<AccountSettingsDto>,
  ) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication token required to update account settings');
    }
    const token = authHeader.substring('Bearer '.length).trim();
    const session = this.authService.verifySessionToken(token);
    if (session.sub.toLowerCase() !== address.toLowerCase()) {
      throw new ForbiddenException('Cannot modify settings for a different wallet address');
    }

    const data = await this.settingsService.upsertAccountSettings(address, body);
    return {
      success: true,
      data,
    };
  }

  @Get(':address/agent')
  async getAgentSettings(@Param('address') address: string) {
    const data = await this.agentSettingsService.getAgentSettings(address);
    return {
      success: true,
      data,
    };
  }

  @Put(':address/agent')
  async updateAgentSettings(
    @Param('address') address: string,
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: Partial<AgentSettingsDto>,
  ) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication token required to update agent settings');
    }
    const token = authHeader.substring('Bearer '.length).trim();
    const session = this.authService.verifySessionToken(token);
    if (session.sub.toLowerCase() !== address.toLowerCase()) {
      throw new ForbiddenException('Cannot modify agent settings for a different wallet address');
    }

    const data = await this.agentSettingsService.upsertAgentSettings(address, body);
    return {
      success: true,
      data,
    };
  }

  @Post(':address/agent/key')
  async generateAgentApiKey(
    @Param('address') address: string,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication token required to generate agent API key');
    }
    const token = authHeader.substring('Bearer '.length).trim();
    const session = this.authService.verifySessionToken(token);
    if (session.sub.toLowerCase() !== address.toLowerCase()) {
      throw new ForbiddenException('Cannot generate agent API key for a different wallet address');
    }

    const data = await this.agentSettingsService.generateApiKey(address);
    return {
      success: true,
      data,
    };
  }

  @Delete(':address/agent/key')
  async revokeAgentApiKey(
    @Param('address') address: string,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication token required to revoke agent API key');
    }
    const token = authHeader.substring('Bearer '.length).trim();
    const session = this.authService.verifySessionToken(token);
    if (session.sub.toLowerCase() !== address.toLowerCase()) {
      throw new ForbiddenException('Cannot revoke agent API key for a different wallet address');
    }

    const data = await this.agentSettingsService.revokeApiKey(address);
    return {
      success: true,
      data,
    };
  }
}
