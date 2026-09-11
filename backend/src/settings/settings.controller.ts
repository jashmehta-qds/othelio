import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { AccountSettingsDto, SettingsService } from './settings.service';

@Controller('v1/settings')
export class SettingsController {
  constructor(
    @Inject(SettingsService)
    private readonly settingsService: SettingsService,
    @Inject(AuthService)
    private readonly authService: AuthService,
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
}
