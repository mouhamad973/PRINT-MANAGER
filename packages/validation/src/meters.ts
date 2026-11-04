import { COLOR_MODES, COMPARISONS, VOLUME_GRANULARITIES } from '@arksen/shared-types';
import { z } from 'zod';
import { listQuerySchema, optionalText } from './access.js';

/** Plafond d'un compteur : au-delà, c'est une erreur de saisie. */
export const MAX_COUNTER = 2_000_000_000;
/** Durée maximale d'une période de volumes, en jours. */
export const MAX_VOLUME_DAYS = 731;
/** Au-delà de cette durée, les volumes sont regroupés par mois. */
export const DAILY_LIMIT_DAYS = 92;
export const MAX_IMPORT_ROWS = 5000;

const counter = (label: string) =>
  z.coerce
    .number(`Saisissez le compteur ${label}.`)
    .int(`Le compteur ${label} est un nombre entier.`)
    .min(0, `Le compteur ${label} ne peut pas être négatif.`)
    .max(MAX_COUNTER, `Le compteur ${label} dépasse ${MAX_COUNTER.toLocaleString('fr-FR')}.`);

const optionalCounter = (label: string) =>
  z.preprocess(
    (value) => (value === '' || value === undefined || Number.isNaN(value) ? null : value),
    counter(label).nullable(),
  );

const readAt = z.iso.datetime({ offset: true, message: 'Saisissez la date et l’heure du relevé.' });

export const meterReadingCreateSchema = z.object({
  readAt,
  blackCount: counter('noir et blanc'),
  /** Obligatoire pour une machine couleur, absent pour une machine noir et blanc (vérifié par l'API). */
  colorCount: optionalCounter('couleur'),
  isReset: z.boolean().default(false),
  notes: optionalText(500),
  /** Identifiant d'idempotence fourni par l'émetteur. */
  externalId: z.uuid().optional(),
});

export const meterImportSchema = z.object({
  rows: z
    .array(
      z.object({
        serialNumber: z.string().trim().min(1, 'Numéro de série manquant.').max(80),
        readAt,
        blackCount: counter('noir et blanc'),
        colorCount: optionalCounter('couleur'),
        isReset: z.boolean().default(false),
      }),
    )
    .min(1, 'Le fichier ne contient aucun relevé.')
    .max(MAX_IMPORT_ROWS, `${MAX_IMPORT_ROWS} relevés maximum par import.`),
});

export const meterReadingListQuerySchema = listQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const optionalParam = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const DAY_MS = 86_400_000;

/** Période de volumes : bornes incluses, en jours UTC. */
export const volumeQuerySchema = z
  .object({
    from: z.iso.date('Date de début invalide.'),
    to: z.iso.date('Date de fin invalide.'),
    granularity: optionalParam(z.enum(VOLUME_GRANULARITIES)),
    compare: optionalParam(z.enum(COMPARISONS)),
    siteId: optionalParam(z.uuid()),
    colorMode: optionalParam(z.enum(COLOR_MODES)),
  })
  .refine((value) => value.to >= value.from, {
    message: 'La fin de la période précède son début.',
    path: ['to'],
  })
  .refine(
    (value) => (Date.parse(value.to) - Date.parse(value.from)) / DAY_MS + 1 <= MAX_VOLUME_DAYS,
    { message: `Période limitée à ${MAX_VOLUME_DAYS} jours.`, path: ['to'] },
  )
  .transform((value) => {
    const days = (Date.parse(value.to) - Date.parse(value.from)) / DAY_MS + 1;
    return {
      ...value,
      granularity:
        value.granularity ?? (days > DAILY_LIMIT_DAYS ? ('month' as const) : ('day' as const)),
      compare: value.compare ?? ('previous' as const),
    };
  });

export type MeterReadingCreateInput = z.infer<typeof meterReadingCreateSchema>;
export type MeterImportInput = z.infer<typeof meterImportSchema>;
export type MeterReadingListQuery = z.infer<typeof meterReadingListQuerySchema>;
export type VolumeQuery = z.infer<typeof volumeQuerySchema>;
