import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';
import { AdminChallengeRequest, AdminChallengeResponse, AdminVerifyRequest, AdminVerifyResponse } from '@othelio/shared';

@Controller('v1/admin/auth')
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

  @Post('challenge')
  getChallenge(@Body() body: AdminChallengeRequest): AdminChallengeResponse {
    return this.authService.generateChallenge(body.address, body.chainId);
  }

  @Post('verify')
  async verify(@Body() body: AdminVerifyRequest): Promise<AdminVerifyResponse> {
    return this.authService.verifyChallenge(body.address, body.message, body.signature, body.chainId);
  }

  @Get('me')
  @UseGuards(AdminGuard)
  async getMe(@Req() req: any) {
    const isOwner = await this.authService.isOwner(req.adminUser.address, req.adminUser.chainId);
    const factoryAddress = this.authService.getFactoryAddress(req.adminUser.chainId);
    return {
      address: req.adminUser.address,
      chainId: req.adminUser.chainId,
      isOwner,
      factoryAddress,
    };
  }
}
