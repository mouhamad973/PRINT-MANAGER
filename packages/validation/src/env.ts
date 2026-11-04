import { DEPLOYMENT_MODES } from '@arksen/shared-types';
import { z } from 'zod';

const nodeEnv = z.enum(['development', 'test', 'production']).default('development');
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const redisUrl = z.url({ protocol: /^rediss?$/ });

/** Une variable définie mais vide (`VAR=`) est traitée comme absente. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** Variables d'environnement de l'API NestJS. */
export const apiEnvSchema = z
  .object({
    NODE_ENV: nodeEnv,
    DEPLOYMENT_MODE: z.enum(DEPLOYMENT_MODES),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    /** Rôle `arksen_app`, soumis au Row-Level Security. */
    DATABASE_APP_URL: postgresUrl,
    /** Rôle `arksen_system` (BYPASSRLS) : authentification et opérations de plateforme. */
    DATABASE_SYSTEM_URL: postgresUrl,
    REDIS_URL: redisUrl,
    ANALYTICS_URL: z.url(),
    /** Adresse publique du frontend, seule origine autorisée par l'authentification. */
    PUBLIC_WEB_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32, 'au moins 32 caractères'),
    /** Clé AES-256 des secrets SNMP, 64 caractères hexadécimaux. La perdre rend ces secrets illisibles. */
    CREDENTIALS_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, '64 caractères hexadécimaux (32 octets)'),
    /** Création du premier Super Administrateur, uniquement si aucun n'existe. */
    SUPER_ADMIN_EMAIL: optional(z.email()),
    SUPER_ADMIN_PASSWORD: optional(z.string().min(12, 'au moins 12 caractères')),
    SUPER_ADMIN_NAME: optional(z.string().min(2)).transform(
      (value) => value ?? 'Administrateur Arksen',
    ),
  })
  .refine((env) => Boolean(env.SUPER_ADMIN_EMAIL) === Boolean(env.SUPER_ADMIN_PASSWORD), {
    message: 'à définir avec SUPER_ADMIN_EMAIL, ou pas du tout',
    path: ['SUPER_ADMIN_PASSWORD'],
  });
export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** Variables d'environnement des workers BullMQ. */
export const workersEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  REDIS_URL: redisUrl,
});
export type WorkersEnv = z.infer<typeof workersEnvSchema>;

/**
 * Valide un environnement au démarrage. Le message d'erreur liste les variables
 * invalides sans jamais reproduire leurs valeurs, qui peuvent contenir des secrets.
 */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  env: Record<string, string | undefined>,
): z.infer<T> {
  const result = schema.safeParse(env);
  if (result.success) {
    return result.data;
  }
  const details = result.error.issues
    .map((issue) => `  - ${issue.path.join('.')} : ${issue.message}`)
    .join('\n');
  throw new Error(`Configuration invalide :\n${details}`);
}
