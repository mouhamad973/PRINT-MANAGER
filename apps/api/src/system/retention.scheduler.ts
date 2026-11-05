import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';
import { RetentionService } from './retention.service.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const LOCK_KEY = 'arksen:retention:daily';

/**
 * Applique la politique de conservation une fois par jour. La vérification est horaire et un
 * verrou Redis de 24 heures garantit une seule purge par jour, sur une seule instance de l'API.
 */
@Injectable()
export class RetentionScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RetentionScheduler.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly retention: RetentionService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap() {
    this.timers.push(setTimeout(() => void this.tick(), 10 * 60 * 1000).unref());
    this.timers.push(setInterval(() => void this.tick(), HOUR_MS).unref());
  }

  onModuleDestroy() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  async tick(): Promise<void> {
    try {
      const locked = await this.redis.set(LOCK_KEY, String(process.pid), 'PX', DAY_MS, 'NX');
      if (locked !== 'OK') return;
    } catch (error) {
      this.logger.warn(`Purge de conservation reportée : ${(error as Error).message}`);
      return;
    }
    try {
      const run = await this.retention.run('scheduled');
      this.logger.log(`Conservation appliquée : ${JSON.stringify(run.purged)}`);
    } catch (error) {
      this.logger.error(`Purge de conservation en échec : ${(error as Error).message}`);
    }
  }
}
