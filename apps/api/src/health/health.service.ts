import type { PrismaClient } from '@arksen/database';
import {
  CRITICAL_DEPENDENCIES,
  type DependencyHealth,
  type DependencyName,
  type HealthReport,
  WORKER_HEARTBEAT_KEY,
} from '@arksen/shared-types';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PRISMA_SYSTEM } from '../database/database.module.js';
import { REDIS } from '../redis/redis.module.js';
import { API_VERSION } from '../version.js';

const CHECK_TIMEOUT_MS = 2_000;

/**
 * Seuls ces messages sont publiés : /health est public, et les erreurs de pilote
 * peuvent contenir l'hôte ou l'URL de connexion.
 */
class PublicCheckError extends Error {}

@Injectable()
export class HealthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async check(): Promise<HealthReport> {
    const [database, redis, analytics, workers] = await Promise.all([
      this.probe('database', async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }),
      this.probe('redis', async () => {
        await this.redis.ping();
      }),
      this.probe('analytics', () => this.checkAnalytics()),
      this.probe('workers', () => this.checkWorkers()),
    ]);
    const dependencies = { database, redis, analytics, workers };

    return {
      status: overallStatus(Object.values(dependencies)),
      version: API_VERSION,
      checkedAt: new Date().toISOString(),
      dependencies,
    };
  }

  private async checkAnalytics(): Promise<void> {
    const response = await fetch(new URL('/health', this.config.ANALYTICS_URL), {
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new PublicCheckError(`réponse HTTP ${response.status}`);
    }
  }

  /** Les workers publient un heartbeat à durée de vie limitée : sa présence prouve leur activité. */
  private async checkWorkers(): Promise<void> {
    const heartbeat = await this.redis.get(WORKER_HEARTBEAT_KEY);
    if (heartbeat === null) {
      throw new PublicCheckError('aucun heartbeat récent');
    }
  }

  private async probe(name: DependencyName, check: () => Promise<void>): Promise<DependencyHealth> {
    const critical = CRITICAL_DEPENDENCIES.includes(name);
    const startedAt = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        check(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new PublicCheckError('délai dépassé')), CHECK_TIMEOUT_MS);
        }),
      ]);
      return { status: 'up', critical, latencyMs: Math.round(performance.now() - startedAt) };
    } catch (error) {
      return {
        status: 'down',
        critical,
        latencyMs: null,
        message: error instanceof PublicCheckError ? error.message : 'service injoignable',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function overallStatus(dependencies: DependencyHealth[]): HealthReport['status'] {
  if (dependencies.some((dependency) => dependency.critical && dependency.status === 'down')) {
    return 'error';
  }
  return dependencies.some((dependency) => dependency.status === 'down') ? 'degraded' : 'ok';
}
