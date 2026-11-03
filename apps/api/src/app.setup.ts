import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { toNodeHandler } from 'better-auth/node';
import helmet from 'helmet';
import { AUTH, type Auth } from './auth/auth.js';
import { API_VERSION } from './version.js';

/**
 * Configuration commune à l'application réelle et aux tests.
 * L'application doit être créée avec `bodyParser: false` : Better Auth lit lui-même le corps
 * de ses requêtes, et son gestionnaire doit donc être monté avant le parseur JSON.
 */
export function configureApp(app: NestExpressApplication): void {
  // Le frontend relaie les requêtes depuis le réseau privé : son X-Forwarded-For est cru.
  app.set('trust proxy', ['loopback', 'uniquelocal']);
  app.disable('x-powered-by');
  // L'API ne sert que du JSON, hors /docs dont l'interface a besoin de scripts en ligne.
  app.use(helmet({ contentSecurityPolicy: false }));

  const auth = app.get<Auth>(AUTH);
  app.getHttpAdapter().getInstance().all('/api/auth/{*path}', toNodeHandler(auth));
  app.useBodyParser('json', { limit: '1mb' });

  // /health reste hors préfixe : c'est le point d'entrée des sondes d'infrastructure.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ARKSEN PRINT MANAGER API')
      .setDescription(
        'API REST de la plateforme de gestion des parcs d’impression.\n\n' +
          'L’authentification passe par `POST /api/auth/sign-in/email` (Better Auth), ' +
          'qui dépose le cookie de session `arksen.session_token`.',
      )
      .setVersion(API_VERSION)
      .addCookieAuth('arksen.session_token')
      .build(),
  );
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });
}
