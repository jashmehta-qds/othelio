import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { AdminCapability } from '@othelio/shared';
import { AdminAuthService } from './admin-auth.service';

const OWNER_CAPABILITY = 'admin:owner-capability';
export const RequireAdminOwner = (capability: AdminCapability) => SetMetadata(OWNER_CAPABILITY, capability);
export const AdminChain = createParamDecorator((_: unknown, context: ExecutionContext): number =>
  context.switchToHttp().getRequest().adminUser.chainId,
);

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

    if ([req.query?.chainId, req.body?.chainId].some((id) => id !== undefined && Number(id) !== payload.chainId)) {
      throw new UnauthorizedException(
        `Admin session is bound to chain ${payload.chainId}. Sign in again on the requested network.`,
      );
    }

    // Recheck onchain owner authority to guard against revoked ownership
    const operator = await this.authService.checkOnchainOwner(payload.sub, payload.chainId);
    const capability: AdminCapability | undefined = Reflect.getMetadata(OWNER_CAPABILITY, context.getHandler());
    if (capability && !operator.capabilities[capability]) {
      throw new ForbiddenException(`Connected wallet does not own the configured ${capability} contract.`);
    }
    req.adminUser = operator;

    return true;
  }
}
