import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('v1/auth')
export class AuthController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
  ) {}

  @Get('nonce')
  getNonce(@Query('address') address: string) {
    const data = this.authService.generateNonce(address);
    return {
      success: true,
      data,
    };
  }

  @Post('verify')
  async verifySignature(
    @Body() body: { address: string; message: string; signature: string },
  ) {
    const data = await this.authService.verifySignature(body.address, body.message, body.signature);
    return {
      success: true,
      data,
    };
  }
}
