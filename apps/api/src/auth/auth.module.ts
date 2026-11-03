import type { PrismaClient } from '@arksen/database';
import { Global, Inject, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module.js';
import { AuditService } from '../audit/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PRISMA_SYSTEM } from '../database/database.module.js';
import { AccountsService } from './accounts.service.js';
import { AUTH, createAuth } from './auth.js';
import { AuthenticationGuard } from './authentication.guard.js';
import { AuthorizationGuard } from './authorization.guard.js';

@Global()
@Module({
  imports: [AuditModule],
  providers: [
    {
      provide: AUTH,
      inject: [APP_CONFIG, PRISMA_SYSTEM, AuditService],
      useFactory: createAuth,
    },
    AccountsService,
    // L'ordre compte : l'autorisation s'appuie sur l'identité établie par l'authentification.
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
  ],
  exports: [AUTH, AccountsService],
})
export class AuthModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PRISMA_SYSTEM) private readonly systemPrisma: PrismaClient,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
  ) {}

  /** Installation initiale : crée le premier Super Administrateur si aucun n'existe encore. */
  async onApplicationBootstrap(): Promise<void> {
    const { SUPER_ADMIN_EMAIL: email, SUPER_ADMIN_PASSWORD: password } = this.config;
    if (!email || !password) {
      return;
    }
    const existing = await this.systemPrisma.user.count({ where: { role: 'SUPER_ADMIN' } });
    if (existing > 0) {
      return;
    }
    const user = await this.accounts.createCredentialUser({
      name: this.config.SUPER_ADMIN_NAME,
      email: email.toLowerCase(),
      role: 'SUPER_ADMIN',
      tenantId: null,
      password,
    });
    await this.audit.record({
      action: 'platform.super_admin_bootstrapped',
      targetType: 'user',
      targetId: user.id,
      metadata: { email: user.email },
    });
    this.logger.log(`Premier Super Administrateur créé : ${user.email}`);
  }
}
