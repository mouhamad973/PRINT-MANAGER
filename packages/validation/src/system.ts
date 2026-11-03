import { DEPLOYMENT_MODES } from '@arksen/shared-types';
import { z } from 'zod';

const dependencyHealthSchema = z.object({
  status: z.enum(['up', 'down']),
  critical: z.boolean(),
  latencyMs: z.number().nonnegative().nullable(),
  message: z.string().optional(),
});

/** Réponse de `GET /health`, validée par le frontend à la réception. */
export const healthReportSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  version: z.string(),
  checkedAt: z.iso.datetime(),
  dependencies: z.object({
    database: dependencyHealthSchema,
    redis: dependencyHealthSchema,
    analytics: dependencyHealthSchema,
    workers: dependencyHealthSchema,
  }),
});

/** Réponse de `GET /api/v1/system/info`. */
export const systemInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  deploymentMode: z.enum(DEPLOYMENT_MODES),
});
