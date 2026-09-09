import { generateKeyPairSync } from 'node:crypto';
import { sign, SignOptions } from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { KeycloakJwtVerifier } from './keycloak-jwt.verifier';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const issuer = 'https://identity.example.com/realms/test';
const audience = 'notification-service';
const verifier = new KeycloakJwtVerifier(
  new ConfigService({
    KEYCLOAK_PUBLIC_KEY: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    KEYCLOAK_ISSUER: issuer,
    KEYCLOAK_AUDIENCE: audience,
  }),
);
const token = (payload = {}, options: SignOptions = {}) =>
  sign({ typ: 'Bearer', ...payload }, keys.privateKey, {
    algorithm: 'RS256',
    issuer,
    audience,
    subject: 'user-123',
    expiresIn: 60,
    ...options,
  });

describe('Keycloak local JWT verification', () => {
  it('accepts a signed access token without contacting Keycloak', () => {
    expect(verifier.verify(token()).sub).toBe('user-123');
  });

  it.each([
    ['expired', () => token({}, { expiresIn: -1 })],
    ['future nbf', () => token({}, { notBefore: 60 })],
    ['wrong issuer', () => token({}, { issuer: 'https://attacker.example.com' })],
    ['wrong audience', () => token({}, { audience: 'another-service' })],
    ['ID token', () => token({ typ: 'ID' })],
    [
      'missing expiration',
      () =>
        sign({ typ: 'Bearer', sub: 'user-123' }, keys.privateKey, {
          algorithm: 'RS256',
          issuer,
          audience,
        }),
    ],
    [
      'missing subject',
      () =>
        sign({ typ: 'Bearer' }, keys.privateKey, {
          algorithm: 'RS256',
          issuer,
          audience,
          expiresIn: 60,
        }),
    ],
    ['malformed', () => 'invalid.token'],
    [
      'wrong signature',
      () =>
        sign({ typ: 'Bearer' }, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey, {
          algorithm: 'RS256',
          issuer,
          audience,
          subject: 'user-123',
          expiresIn: 60,
        }),
    ],
    [
      'HS256',
      () => sign({ sub: 'user-123', typ: 'Bearer' }, 'secret', { issuer, audience, expiresIn: 60 }),
    ],
  ])('rejects %s', (_name, makeToken) => {
    expect(() => verifier.verify(makeToken())).toThrow(UnauthorizedException);
  });
});
