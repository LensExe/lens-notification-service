import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './keycloak-jwt.guard';

export const RequireRoles = (...roles: string[]) => SetMetadata('notification:roles', roles);

@Injectable()
export class NotificationRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<string[]>('notification:roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const granted = request.user.roles ?? [];
    if (!required.some((role) => granted.includes(role))) {
      throw new ForbiddenException('Required role missing');
    }
    return true;
  }
}
