import type { PrismaClient } from '@arksen/database';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PRISMA_SYSTEM } from '../database/database.module.js';
import { REDIS } from '../redis/redis.module.js';
import { MaintenanceService } from './maintenance.service.js';

const HOUR_MS = 60 * 60 * 1000;
const LOCK_KEY = 'arksen:maintenance:plan-alerts';

/**
 * Réévalue toutes les heures les échéances de maintenance : les compteurs avancent entre deux
 * actions des utilisateurs. Un verrou Redis confie ce travail à une seule instance de l'API.
 */
@Injectable()
export class MaintenanceScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceScheduler.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly maintenance: MaintenanceService,
    @Inject(PRISMA_SYSTEM) private readonly systemPrisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap() {
    this.timers.push(setTimeout(() => void this.run(), 3 * 60 * 1000).unref());
    this.timers.push(setInterval(() => void this.run(), HOUR_MS).unref());
  }

  onModuleDestroy() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  async run(): Promise<void> {
    try {
      const locked = await this.redis.set(
        LOCK_KEY,
        String(process.pid),
        'PX',
        HOUR_MS - 60_000,
        'NX',
      );
      if (locked !== 'OK') return;
    } catch (error) {
      this.logger.warn(`Échéances de maintenance reportées : ${(error as Error).message}`);
      return;
    }
    const tenants = await this.systemPrisma.maintenancePlan.findMany({
      where: { tenant: { status: 'ACTIVE' } },
      distinct: ['tenantId'],
      select: { tenantId: true },
    });
    for (const { tenantId } of tenants) {
      try {
        await this.maintenance.evaluatePlans(tenantId);
      } catch (error) {
        this.logger.error(`Maintenance de ${tenantId} : ${(error as Error).message}`);
      }
    }
  }
}
