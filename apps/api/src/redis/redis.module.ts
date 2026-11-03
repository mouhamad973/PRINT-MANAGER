import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        // Sans file d'attente hors ligne : une commande échoue aussitôt si Redis est absent,
        // et le rapport de santé reflète alors l'état réel au lieu de rester bloqué.
        const redis = new Redis(config.REDIS_URL, {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });
        const logger = new Logger('Redis');
        redis.on('error', (error: Error) => logger.warn(`Connexion Redis : ${error.message}`));
        return redis;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}
