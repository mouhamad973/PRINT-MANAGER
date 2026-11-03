import 'reflect-metadata';
import { systemInfoSchema } from '@arksen/validation';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { PRISMA_APP, PRISMA_SYSTEM } from './database/database.module.js';
import { REDIS } from './redis/redis.module.js';

describe('application', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'on-premise');
    vi.stubEnv('DATABASE_APP_URL', 'postgresql://user:pass@127.0.0.1:1/none');
    vi.stubEnv('DATABASE_SYSTEM_URL', 'postgresql://user:pass@127.0.0.1:1/none');
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:1');
    vi.stubEnv('ANALYTICS_URL', 'http://127.0.0.1:1');
    vi.stubEnv('PUBLIC_WEB_URL', 'http://localhost:3000');
    vi.stubEnv('BETTER_AUTH_SECRET', 'secret-de-test-'.repeat(4));

    // Aucune requête ne doit atteindre la base dans ces tests : le client est vide.
    const prisma: Record<string, unknown> = { $disconnect: vi.fn() };
    prisma.$transaction = (work: (client: unknown) => unknown) => work(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PRISMA_APP)
      .useValue(prisma)
      .overrideProvider(PRISMA_SYSTEM)
      .useValue(prisma)
      .overrideProvider(REDIS)
      .useValue({ disconnect: vi.fn() })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('expose le mode de déploiement sans authentification', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/system/info').expect(200);

    expect(systemInfoSchema.parse(response.body).deploymentMode).toBe('on-premise');
  });

  it('refuse par défaut toute route métier sans session', async () => {
    for (const path of ['/api/v1/me', '/api/v1/tenants', '/api/v1/audit-logs']) {
      await request(app.getHttpServer()).get(path).expect(401);
    }
  });

  it('n’autorise pas l’inscription libre', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Intrus', email: 'intrus@exemple.test', password: 'un-mot-de-passe-long' });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it('ajoute les en-têtes de sécurité', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/system/info');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('publie le document OpenAPI avec les routes attendues', async () => {
    const response = await request(app.getHttpServer()).get('/docs/openapi.json').expect(200);

    const paths = Object.keys((response.body as { paths: object }).paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/health',
        '/api/v1/system/info',
        '/api/v1/me',
        '/api/v1/tenants',
        '/api/v1/tenants/{tenantId}/users',
      ]),
    );
  });

  it('sert l’interface Swagger', async () => {
    await request(app.getHttpServer()).get('/docs').expect(200).expect('Content-Type', /html/);
  });
});
