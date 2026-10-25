import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
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
    const cookieToken = match
      ? undefined
      : readCookie(request.headers.cookie, 'keycloak_access_token');
    const token = match?.[1] ?? cookieToken;
    if (!token) throw new UnauthorizedException('Bearer token required');
    if (cookieToken && !isSafeMethod(request.method)) {
      const csrfCookie = readCookie(request.headers.cookie, 'csrf_token');
      const csrfHeader = request.get('X-CSRF-Token');
      if (!matchesCSRFToken(csrfCookie, csrfHeader)) {
        throw new ForbiddenException('CSRF token required');
      }
    }
    request.user = this.verifier.verify(token);
    return true;
  }
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

function isSafeMethod(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function matchesCSRFToken(cookieToken?: string, headerToken?: string): boolean {
  if (!cookieToken || !headerToken) return false;
  const cookieBuffer = Buffer.from(cookieToken);
  const headerBuffer = Buffer.from(headerToken);
  return cookieBuffer.length === headerBuffer.length && timingSafeEqual(cookieBuffer, headerBuffer);
}
