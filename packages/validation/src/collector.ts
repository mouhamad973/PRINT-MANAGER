import {
  AGENT_MAX_BATCH,
  AGENT_SCHEMA_VERSION,
  DEVICE_STATUSES,
  PRINTER_ACTIVITIES,
  PRINTER_ALERTS,
} from '@arksen/shared-types';
import { z } from 'zod';
import { listQuerySchema, nameSchema } from './access.js';

/** OID SNMP numérique (1.3.6.1…), saisi avec ou sans point initial. */
export const oidSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^\./, ''))
  .pipe(
    z
      .string()
      .max(200, '200 caractères maximum.')
      .regex(
        /^[0-2](\.(0|[1-9]\d*)){5,}$/,
        'Saisissez un OID numérique, par exemple 1.3.6.1.2.1.43…',
      ),
  );

/** OID facultatif d'un formulaire : vide devient `null`. */
export const optionalOidSchema = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  oidSchema.nullable(),
);

// ---------------------------------------------------------------------------
// Administration des agents
// ---------------------------------------------------------------------------

export const agentCreateSchema = z.object({
  name: nameSchema,
  /** Site couvert par l'agent ; sans site, il collecte toutes les machines de l'entreprise. */
  siteId: z.preprocess(
    (value) => (value === '' || value === undefined ? null : value),
    z.uuid('Site invalide.').nullable(),
  ),
});

export const agentUpdateSchema = agentCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Aucune modification fournie.');

export const agentSyncLogQuerySchema = listQuerySchema.extend({
  agentId: z.preprocess((value) => (value === '' ? undefined : value), z.uuid().optional()),
});

export const discoveredDeviceUpdateSchema = z
  .object({
    /** `null` détache l'équipement de sa machine. */
    printerId: z.uuid('Machine invalide.').nullable(),
    ignored: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Aucune modification fournie.');

// ---------------------------------------------------------------------------
// Protocole agent ↔ serveur, version 1
// ---------------------------------------------------------------------------

export const agentEnrollSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .transform((value) => value.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^[A-Z2-7]{16}$/, 'Code d’enregistrement invalide.')),
  hostname: z.string().trim().min(1).max(255),
  version: z.string().trim().min(1).max(40),
  platform: z.string().trim().max(120).optional(),
});

const count = z.number().int().min(0).max(2_147_483_647);
const shortText = (max: number) => z.string().max(max).nullable().optional();

const meterReadingPayload = z.object({
  totalCount: count.nullable().optional(),
  blackCount: count.nullable().optional(),
  colorCount: count.nullable().optional(),
});

const supplySchema = z.object({
  index: z.number().int().min(0),
  description: z.string().max(200),
  kind: z.string().max(40),
  channel: z.enum(['CYAN', 'MAGENTA', 'YELLOW', 'BLACK']).nullable(),
  levelPercent: z.number().min(0).max(100).nullable(),
});

const printerStatusPayload = z.object({
  reachable: z.boolean(),
  error: shortText(500),
  deviceStatus: z.enum(DEVICE_STATUSES).nullable().optional(),
  printerStatus: z.enum(PRINTER_ACTIVITIES).nullable().optional(),
  alerts: z.array(z.enum(PRINTER_ALERTS)).max(PRINTER_ALERTS.length).default([]),
  supplies: z.array(supplySchema).max(64).default([]),
  totalCount: count.nullable().optional(),
  serialNumber: shortText(120),
  description: shortText(255),
});

const deviceDiscoveredPayload = z.object({
  ipAddress: z.union([z.ipv4(), z.ipv6()]),
  serialNumber: shortText(120),
  sysName: shortText(255),
  description: shortText(255),
  macAddress: shortText(40),
});

const envelope = {
  id: z.uuid(),
  schemaVersion: z.literal(AGENT_SCHEMA_VERSION, 'Version de schéma non prise en charge.'),
  agentId: z.uuid(),
  printerId: z.uuid().nullable(),
  occurredAt: z.iso.datetime({ offset: true }),
};

/** Événement de l'outbox d'un agent : UUID, machine, agent, horodatage, version de schéma. */
export const agentEventSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('meter.reading'), payload: meterReadingPayload }),
  z.object({ ...envelope, type: z.literal('printer.status'), payload: printerStatusPayload }),
  z.object({ ...envelope, type: z.literal('device.discovered'), payload: deviceDiscoveredPayload }),
]);

/**
 * Lot envoyé par un agent. Seul l'identifiant de chaque événement est exigé ici : un événement
 * mal formé est rejeté individuellement, pour ne pas bloquer les autres indéfiniment.
 */
export const agentEventsBatchSchema = z.object({
  events: z
    .array(z.looseObject({ id: z.uuid('Événement sans identifiant valide.') }))
    .min(1)
    .max(AGENT_MAX_BATCH, `${AGENT_MAX_BATCH} événements au plus par lot.`),
});

export type AgentCreateInput = z.infer<typeof agentCreateSchema>;
export type AgentUpdateInput = z.infer<typeof agentUpdateSchema>;
export type AgentEnrollInput = z.infer<typeof agentEnrollSchema>;
export type AgentEventInput = z.infer<typeof agentEventSchema>;
export type AgentEventsBatchInput = z.infer<typeof agentEventsBatchSchema>;
export type AgentSyncLogQuery = z.infer<typeof agentSyncLogQuerySchema>;
export type DiscoveredDeviceUpdateInput = z.infer<typeof discoveredDeviceUpdateSchema>;
