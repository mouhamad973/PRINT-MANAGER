import { ALERT_STATUSES, ALERT_TYPES, CMYK_CHANNELS } from '@arksen/shared-types';
import { z } from 'zod';
import { listQuerySchema, optionalText } from './access.js';

const optionalParam = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const quantity = (message: string) =>
  z.coerce
    .number(message)
    .int('Saisissez un nombre entier.')
    .min(1, 'Au moins une cartouche.')
    .max(100_000, '100 000 au plus.');

const threshold = z.coerce
  .number('Saisissez un nombre.')
  .int('Saisissez un nombre entier.')
  .min(0, '0 minimum.')
  .max(100_000, '100 000 au plus.');

const leadTime = z.coerce
  .number('Saisissez un nombre de jours.')
  .int('Saisissez un nombre entier.')
  .min(0, '0 minimum.')
  .max(365, '365 jours au plus.');

/** Référence de cartouche : comparée sans tenir compte de la casse ni des espaces autour. */
const reference = z
  .string()
  .trim()
  .min(1, 'Choisissez une référence.')
  .max(80, '80 caractères maximum.');

const money = z.preprocess(
  (value) => (value === '' || value === null || value === undefined ? null : value),
  z.coerce.number('Saisissez un montant.').min(0, 'Montant positif.').max(1e9).nullable(),
);

/** Date et heure d'un événement passé (5 minutes de tolérance d'horloge). */
const pastDate = z.iso
  .datetime({ offset: true, message: 'Date invalide.' })
  .refine((value) => Date.parse(value) <= Date.now() + 5 * 60_000, 'Date dans le futur.');

export const stockCreateSchema = z.object({
  siteId: z.uuid('Choisissez un site.'),
  reference,
  minQuantity: threshold.default(0),
  leadTimeDays: leadTime.default(7),
});

export const stockUpdateSchema = z
  .object({ minQuantity: threshold, leadTimeDays: leadTime })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Aucune modification fournie.');

export const stockListQuerySchema = listQuerySchema.extend({
  siteId: optionalParam(z.uuid()),
  level: optionalParam(z.enum(['OK', 'LOW', 'OUT'])),
});

/**
 * Mouvement saisi : réception et sortie portent une quantité ; un inventaire porte la quantité
 * comptée, et le mouvement est l'écart avec le stock.
 */
export const stockMovementCreateSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('RECEIPT'),
    quantity: quantity('Saisissez la quantité reçue.'),
    unitCost: money.optional(),
    reference: optionalText(80),
    notes: optionalText(500),
    occurredAt: pastDate.optional(),
  }),
  z.object({
    type: z.literal('ISSUE'),
    quantity: quantity('Saisissez la quantité sortie.'),
    reference: optionalText(80),
    notes: optionalText(500),
    occurredAt: pastDate.optional(),
  }),
  z.object({
    type: z.literal('ADJUSTMENT'),
    countedQuantity: threshold,
    notes: optionalText(500),
    occurredAt: pastDate.optional(),
  }),
]);

export const stockTransferSchema = z.object({
  fromStockId: z.uuid('Choisissez le stock de départ.'),
  toSiteId: z.uuid('Choisissez le site de destination.'),
  quantity: quantity('Saisissez la quantité transférée.'),
  notes: optionalText(500),
});

export const tonerReplacementCreateSchema = z.object({
  printerId: z.uuid('Choisissez une machine.'),
  channel: z.enum(CMYK_CHANNELS, 'Choisissez la couleur.'),
  replacedAt: pastDate,
  /** Stock d'où vient la cartouche : une installation en est déduite. */
  stockId: z.preprocess(
    (value) => (value === '' || value === undefined ? null : value),
    z.uuid('Stock invalide.').nullable(),
  ),
  previousLevelPercent: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? null : value),
    z.coerce.number('Saisissez un pourcentage.').min(0).max(100).nullable(),
  ),
  notes: optionalText(500),
});

export const tonerReplacementListQuerySchema = listQuerySchema.extend({
  printerId: optionalParam(z.uuid()),
});

export const alertListQuerySchema = listQuerySchema.extend({
  status: optionalParam(z.enum([...ALERT_STATUSES, 'ACTIVE'])),
  type: optionalParam(z.enum(ALERT_TYPES)),
});

export const alertActionSchema = z.object({
  action: z.enum(['acknowledge', 'resolve']),
});

export type StockCreateInput = z.infer<typeof stockCreateSchema>;
export type StockUpdateInput = z.infer<typeof stockUpdateSchema>;
export type StockListQuery = z.infer<typeof stockListQuerySchema>;
export type StockMovementCreateInput = z.infer<typeof stockMovementCreateSchema>;
export type StockTransferInput = z.infer<typeof stockTransferSchema>;
export type TonerReplacementCreateInput = z.infer<typeof tonerReplacementCreateSchema>;
export type TonerReplacementListQuery = z.infer<typeof tonerReplacementListQuerySchema>;
export type AlertListQuery = z.infer<typeof alertListQuerySchema>;
export type AlertActionInput = z.infer<typeof alertActionSchema>;
