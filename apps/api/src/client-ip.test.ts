import 'reflect-metadata';
import { Controller, Get, Headers } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveClientIp } from './app.setup.js';
import { CLIENT_IP_HEADER } from './auth/auth.js';

@Controller()
class EchoController {
  @Get()
  echo(@Headers(CLIENT_IP_HEADER) ip: string) {
    return { ip };
  }
}

describe('adresse du client', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [EchoController] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    // Même réglage que configureApp.
    app.set('trust proxy', ['loopback', 'uniquelocal']);
    app.use(resolveClientIp);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('garde l’adresse privée d’un poste du réseau local transmise par le proxy', async () => {
    const reply = await request(app.getHttpServer())
      .get('/')
      .set('X-Forwarded-For', '192.168.1.50');
    expect(reply.body.ip).toBe('192.168.1.50');
  });

  it('retient le premier saut non fiable d’une chaîne de proxys', async () => {
    const reply = await request(app.getHttpServer())
      .get('/')
      .set('X-Forwarded-For', '203.0.113.7, 198.51.100.9, 10.0.0.4');
    expect(reply.body.ip).toBe('198.51.100.9');
  });

  it('remplace toujours l’en-tête envoyé par le client', async () => {
    const reply = await request(app.getHttpServer())
      .get('/')
      .set(CLIENT_IP_HEADER, '203.0.113.66')
      .set('X-Forwarded-For', '192.168.1.51');
    expect(reply.body.ip).toBe('192.168.1.51');
  });
});
