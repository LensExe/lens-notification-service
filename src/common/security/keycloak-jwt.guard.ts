import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { KeycloakJwtVerifier, Principal } from './keycloak-jwt.verifier';

export type AuthenticatedRequest = Request & { user: Principal };

@Injectable()
export class KeycloakJwtGuard implements CanActivate {
  constructor(private readonly verifier: KeycloakJwtVerifier) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true; // Gateway verifies WebSocket handshakes locally.
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('Bearer token required');
    request.user = this.verifier.verify(match[1]);
    return true;
  }
}
