import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly authService: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new UnauthorizedException('Empty bearer token');
    }

    const payload = this.authService.verifySessionToken(token);

    // Recheck onchain owner authority to guard against revoked ownership
    await this.authService.checkOnchainOwner(payload.sub, payload.chainId);

    req.adminUser = {
      address: payload.sub,
      chainId: payload.chainId,
    };

    return true;
  }
}
