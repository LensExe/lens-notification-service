import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { KeycloakJwtVerifier } from './keycloak-jwt.verifier';
import { KeycloakJwtGuard } from './keycloak-jwt.guard';

@Global()
@Module({
  providers: [KeycloakJwtVerifier, { provide: APP_GUARD, useClass: KeycloakJwtGuard }],
  exports: [KeycloakJwtVerifier],
})
export class SecurityModule {}
