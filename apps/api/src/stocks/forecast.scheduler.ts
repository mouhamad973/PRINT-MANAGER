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
import { StocksService } from './stocks.service.js';

const HOUR_MS = 60 * 60 * 1000;
const LOCK_KEY = 'arksen:stocks:forecast-alerts';

/**
 * Réévalue toutes les heures les alertes de rupture prévue de chaque entreprise. Un verrou
 * Redis garantit qu'une seule instance de l'API s'en charge à la fois.
 */
@Injectable()
export class ForecastScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ForecastScheduler.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly stocks: StocksService,
    @Inject(PRISMA_SYSTEM) private readonly systemPrisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap() {
    // Premier passage peu après le démarrage, puis toutes les heures.
    this.timers.push(setTimeout(() => void this.run(), 2 * 60 * 1000).unref());
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
      this.logger.warn(`Alertes de rupture prévue reportées : ${(error as Error).message}`);
      return;
    }
    const tenants = await this.systemPrisma.tonerStock.findMany({
      where: { tenant: { status: 'ACTIVE' } },
      distinct: ['tenantId'],
      select: { tenantId: true },
    });
    for (const { tenantId } of tenants) {
      try {
        await this.stocks.evaluateForecastAlerts(tenantId);
      } catch (error) {
        this.logger.error(`Prévisions de ${tenantId} : ${(error as Error).message}`);
      }
    }
  }
}
