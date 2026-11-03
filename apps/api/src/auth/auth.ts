import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@arksen/database';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@arksen/validation';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware, getIP } from 'better-auth/api';
import type { AuditService } from '../audit/audit.service.js';
import type { AppConfig } from '../config/app-config.js';

export const AUTH = Symbol('AUTH');

/** Proxys dont l'en-tête X-Forwarded-For est cru : réseaux privés (conteneurs) et boucle locale. */
const TRUSTED_PROXIES = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '::1/128',
  'fc00::/7',
];

const SESSION_DURATION_SECONDS = 12 * 60 * 60;

export function createAuth(config: AppConfig, systemPrisma: PrismaClient, audit: AuditService) {
  /** Refuse la session d'un compte désactivé ou d'une entreprise suspendue. */
  async function assertAccountActive(userId: string): Promise<void> {
    const user = await systemPrisma.user.findUnique({
      where: { id: userId },
      select: { status: true, email: true, tenantId: true, tenant: { select: { status: true } } },
    });
    const reason =
      !user || user.status !== 'ACTIVE'
        ? 'account_disabled'
        : user.tenant && user.tenant.status !== 'ACTIVE'
          ? 'tenant_suspended'
          : null;
    if (reason) {
      await audit.record({
        action: 'auth.sign_in_refused',
        tenantId: user?.tenantId,
        actorUserId: userId,
        actorEmail: user?.email,
        metadata: { reason },
      });
      // Message identique dans les deux cas : il ne révèle pas l'état de l'entreprise.
      throw new APIError('FORBIDDEN', {
        message: 'Ce compte est désactivé.',
        code: 'ACCOUNT_DISABLED',
      });
    }
  }

  return betterAuth({
    appName: 'ARKSEN Print Manager',
    baseURL: config.PUBLIC_WEB_URL,
    basePath: '/api/auth',
    secret: config.BETTER_AUTH_SECRET,
    database: prismaAdapter(systemPrisma, { provider: 'postgresql', transaction: true }),
    trustedOrigins: [new URL(config.PUBLIC_WEB_URL).origin],
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      // Les comptes sont créés par un administrateur, jamais par inscription libre.
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      revokeSessionsOnPasswordReset: true,
    },
    user: {
      additionalFields: {
        // `input: false` : ces champs ne peuvent jamais être fournis par le client.
        role: { type: 'string', required: false, defaultValue: 'USER', input: false },
        status: { type: 'string', required: false, defaultValue: 'ACTIVE', input: false },
        tenantId: { type: 'string', required: false, input: false },
      },
    },
    session: {
      expiresIn: SESSION_DURATION_SECONDS,
      updateAge: 60 * 60,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/change-password': { window: 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: 'arksen',
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'], trustedProxies: TRUSTED_PROXIES },
      database: { generateId: () => randomUUID() },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            await assertAccountActive(session.userId);
          },
          after: async (session) => {
            const user = await systemPrisma.user.findUnique({
              where: { id: session.userId },
              select: { email: true, tenantId: true },
            });
            await audit.record({
              action: 'auth.sign_in',
              tenantId: user?.tenantId,
              actorUserId: session.userId,
              actorEmail: user?.email,
              ipAddress: session.ipAddress ?? null,
              userAgent: session.userAgent ?? null,
            });
          },
        },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const failed = ctx.context.returned instanceof APIError;
        if (ctx.path === '/sign-in/email' && failed) {
          const email = typeof ctx.body?.email === 'string' ? ctx.body.email.toLowerCase() : null;
          await audit.record({
            action: 'auth.sign_in_failed',
            actorEmail: email,
            ipAddress: ctx.request ? getIP(ctx.request, ctx.context.options) : null,
            userAgent: ctx.request?.headers.get('user-agent') ?? null,
          });
        }
        if (ctx.path === '/change-password' && !failed) {
          const session = ctx.context.session;
          if (session) {
            const user = session.user as { tenantId?: string | null };
            await audit.record({
              action: 'auth.password_changed',
              tenantId: user.tenantId ?? null,
              actorUserId: session.user.id,
              actorEmail: session.user.email,
            });
          }
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
