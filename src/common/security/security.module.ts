import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { KeycloakJwtVerifier } from './keycloak-jwt.verifier';
import { KeycloakJwtGuard } from './keycloak-jwt.guard';
import { NotificationRoleGuard } from './role.guard';

@Global()
@Module({
  providers: [
    KeycloakJwtVerifier,
    { provide: APP_GUARD, useClass: KeycloakJwtGuard },
    { provide: APP_GUARD, useClass: NotificationRoleGuard },
  ],
  exports: [KeycloakJwtVerifier],
})
export class SecurityModule {}
