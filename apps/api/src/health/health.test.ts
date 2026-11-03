import 'reflect-metadata';
import { WORKER_HEARTBEAT_KEY, type HealthReport } from '@arksen/shared-types';
import { healthReportSchema } from '@arksen/validation';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG } from '../config/app-config.js';
import { PRISMA_SYSTEM } from '../database/database.module.js';
import { REDIS } from '../redis/redis.module.js';
import { HealthModule } from './health.module.js';

const prisma = { $queryRaw: vi.fn() };
const redis = { ping: vi.fn(), get: vi.fn() };
const fetchMock = vi.fn();

async function getHealth(app: INestApplication) {
  const response = await request(app.getHttpServer()).get('/health');
  return { httpStatus: response.status, report: response.body as HealthReport };
}

describe('GET /health', () => {
  let app: INestApplication;

  beforeEach(async () => {
    prisma.$queryRaw.mockReset().mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockReset().mockResolvedValue('PONG');
    redis.get.mockReset().mockResolvedValue(new Date().toISOString());
    fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
      providers: [],
    })
      .useMocker((token) => {
        if (token === APP_CONFIG) return { ANALYTICS_URL: 'http://analytics.test:8000' };
        if (token === PRISMA_SYSTEM) return prisma;
        if (token === REDIS) return redis;
        return undefined;
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  it('répond ok et respecte le contrat partagé quand tout fonctionne', async () => {
    const { httpStatus, report } = await getHealth(app);

    expect(httpStatus).toBe(200);
    expect(report.status).toBe('ok');
    expect(healthReportSchema.safeParse(report).success).toBe(true);
    expect(redis.get).toHaveBeenCalledWith(WORKER_HEARTBEAT_KEY);
  });

  it('répond 503 si la base de données est indisponible', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const { httpStatus, report } = await getHealth(app);

    expect(httpStatus).toBe(503);
    expect(report.status).toBe('error');
    expect(report.dependencies.database.status).toBe('down');
    expect(report.dependencies.redis.status).toBe('up');
  });

  it('répond 503 si Redis est indisponible', async () => {
    redis.ping.mockRejectedValue(new Error('Stream isn’t writeable'));

    const { httpStatus, report } = await getHealth(app);

    expect(httpStatus).toBe(503);
    expect(report.dependencies.redis.status).toBe('down');
  });

  it('reste à 200 en mode dégradé si le service analytics est absent', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const { httpStatus, report } = await getHealth(app);

    expect(httpStatus).toBe(200);
    expect(report.status).toBe('degraded');
    expect(report.dependencies.analytics.status).toBe('down');
  });

  it('considère analytics indisponible si le service répond en erreur', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));

    const { report } = await getHealth(app);

    expect(report.dependencies.analytics.status).toBe('down');
    expect(report.dependencies.analytics.message).toBe('réponse HTTP 500');
  });

  it('signale les workers absents quand le heartbeat a expiré', async () => {
    redis.get.mockResolvedValue(null);

    const { httpStatus, report } = await getHealth(app);

    expect(httpStatus).toBe(200);
    expect(report.status).toBe('degraded');
    expect(report.dependencies.workers.message).toBe('aucun heartbeat récent');
  });

  it('n’expose jamais le détail des erreurs de pilote', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('postgresql://user:secret@db:5432 refused'));

    const { report } = await getHealth(app);

    expect(report.dependencies.database.message).toBe('service injoignable');
  });
});
