import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, KeyObject } from 'node:crypto';
import { JwtPayload, verify } from 'jsonwebtoken';

export interface Principal extends JwtPayload {
  sub: string;
  exp: number;
}

@Injectable()
export class KeycloakJwtVerifier {
  private readonly publicKey: KeyObject;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(config: ConfigService) {
    this.publicKey = createPublicKey(
      config.getOrThrow<string>('KEYCLOAK_PUBLIC_KEY').replace(/\\n/g, '\n'),
    );
    if (this.publicKey.asymmetricKeyType !== 'rsa')
      throw new Error('KEYCLOAK_PUBLIC_KEY must be an RSA public key');
    this.issuer = config.getOrThrow<string>('KEYCLOAK_ISSUER');
    this.audience = config.getOrThrow<string>('KEYCLOAK_AUDIENCE');
  }

  verify(token: string): Principal {
    try {
      const claims = verify(token, this.publicKey, {
        algorithms: ['RS256'],
        issuer: this.issuer,
        audience: this.audience,
      });
      if (
        typeof claims === 'string' ||
        claims.typ !== 'Bearer' ||
        typeof claims.sub !== 'string' ||
        !claims.sub ||
        typeof claims.exp !== 'number'
      ) {
        throw new Error('Missing required claims');
      }
      return claims as Principal;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
