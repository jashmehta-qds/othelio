import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AgentSettingsService } from './agent-settings.service';

@Injectable()
export class AgentGuard implements CanActivate {
  constructor(
    @Inject(AgentSettingsService)
    private readonly agentSettings: AgentSettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const headers = request.headers;

    let apiKey = headers['x-agent-key'];
    if (!apiKey && headers['authorization']?.startsWith('Bearer ')) {
      apiKey = headers['authorization'].substring('Bearer '.length).trim();
    }

    if (!apiKey || typeof apiKey !== 'string') {
      throw new UnauthorizedException('Missing X-Agent-Key header or Bearer authorization token.');
    }

    const settings = await this.agentSettings.verifyAgentApiKey(apiKey);
    request.agentSettings = settings;
    request.agentAccountAddress = settings.accountAddress;

    return true;
  }
}
