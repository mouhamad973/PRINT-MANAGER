import { createPrismaClient, type PrismaClient } from '@arksen/database';
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

/**
 * Client du rôle `arksen_app`, soumis au Row-Level Security.
 * Toute lecture de données d'entreprise passe par `withTenant(appPrisma, tenantId, ...)`.
 */
export const PRISMA_APP = Symbol('PRISMA_APP');

/**
 * Client du rôle `arksen_system` (BYPASSRLS), réservé à l'authentification,
 * au journal d'audit et aux opérations explicitement transverses de la plateforme.
 */
export const PRISMA_SYSTEM = Symbol('PRISMA_SYSTEM');

@Global()
@Module({
  providers: [
    {
      provide: PRISMA_APP,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createPrismaClient(config.DATABASE_APP_URL),
    },
    {
      provide: PRISMA_SYSTEM,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createPrismaClient(config.DATABASE_SYSTEM_URL),
    },
  ],
  exports: [PRISMA_APP, PRISMA_SYSTEM],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    @Inject(PRISMA_SYSTEM) private readonly systemPrisma: PrismaClient,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.appPrisma.$disconnect(), this.systemPrisma.$disconnect()]);
  }
}
