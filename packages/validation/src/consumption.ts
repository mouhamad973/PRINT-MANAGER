import {
  CMYK_CHANNELS,
  MEASUREMENT_METHODS,
  PAPER_FORMATS,
  COLOR_MODES,
} from '@arksen/shared-types';
import { z } from 'zod';
import { optionalText } from './access.js';
import { MAX_VOLUME_DAYS } from './meters.js';

const number = (message: string) => z.coerce.number(message).refine(Number.isFinite, message);

const percent = (label: string) =>
  number(`Saisissez ${label}.`)
    .min(0, `${label} : entre 0 et 100 %.`)
    .max(100, `${label} : entre 0 et 100 %.`);

const optionalParam = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

export const tonerSpecSchema = z.object({
  reference: z.string().trim().min(1, 'Saisissez la référence de la cartouche.').max(60),
  capacityGrams: number('Saisissez la masse de toner.')
    .positive('La masse de toner doit être positive.')
    .max(10_000, '10 000 g maximum.'),
  yieldPages: z.coerce
    .number('Saisissez le rendement.')
    .int('Le rendement est un nombre entier de pages.')
    .positive('Le rendement doit être positif.')
    .max(10_000_000, 'Rendement trop élevé.'),
  referenceCoverage: number('Saisissez la couverture de référence.')
    .positive('La couverture de référence doit être positive.')
    .max(100, 'La couverture de référence ne dépasse pas 100 %.')
    .default(5),
});

/** Prix d'une cartouche ; `null` le retire. */
export const tonerPriceSchema = z.object({
  unitPrice: z.preprocess(
    (value) => (value === '' || value === undefined ? null : value),
    number('Saisissez un prix.')
      .min(0, 'Un prix ne peut pas être négatif.')
      .max(1_000_000_000)
      .nullable(),
  ),
});

const perChannel = <T extends z.ZodType>(schema: T) =>
  z.object(
    Object.fromEntries(CMYK_CHANNELS.map((channel) => [channel, schema])) as Record<
      (typeof CMYK_CHANNELS)[number],
      T
    >,
  );

const coefficient = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  number('Saisissez un coefficient.')
    .min(0.1, 'Coefficient compris entre 0,1 et 10.')
    .max(10, 'Coefficient compris entre 0,1 et 10.')
    .nullable(),
);

export const calibrationProfileSchema = z.object({
  coverage: perChannel(percent('la couverture')),
  paperFormat: z.enum(PAPER_FORMATS),
  mediaFactor: number('Saisissez le facteur de support.')
    .min(0.1, 'Facteur de support compris entre 0,1 et 5.')
    .max(5, 'Facteur de support compris entre 0,1 et 5.'),
  manualCoefficients: perChannel(coefficient),
});

export const measurementCreateSchema = z
  .object({
    channel: z.enum(CMYK_CHANNELS, 'Choisissez un canal.'),
    /** Premier et dernier jour de la période, inclus. */
    from: z.iso.date('Saisissez la date de début.'),
    to: z.iso.date('Saisissez la date de fin.'),
    method: z.enum(MEASUREMENT_METHODS),
    grams: z.preprocess(
      (value) => (value === '' || value === undefined ? null : value),
      number('Saisissez la masse consommée.')
        .min(0, 'Une masse ne peut pas être négative.')
        .max(100_000)
        .nullable(),
    ),
    cartridges: z.preprocess(
      (value) => (value === '' || value === undefined ? null : value),
      number('Saisissez le nombre de cartouches.')
        .positive('Au moins une cartouche.')
        .max(1000)
        .nullable(),
    ),
    notes: optionalText(500),
  })
  .refine((value) => value.to >= value.from, {
    message: 'La fin de la période précède son début.',
    path: ['to'],
  })
  .refine((value) => value.method !== 'WEIGHING' || value.grams !== null, {
    message: 'Saisissez la masse de toner pesée.',
    path: ['grams'],
  })
  .refine((value) => value.method !== 'CARTRIDGES' || value.cartridges !== null, {
    message: 'Saisissez le nombre de cartouches vidées.',
    path: ['cartridges'],
  });

const DAY_MS = 86_400_000;

export const consumptionQuerySchema = z
  .object({
    from: z.iso.date('Date de début invalide.'),
    to: z.iso.date('Date de fin invalide.'),
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
  );

export const simulationSchema = z
  .object({
    printerId: optionalParam(z.uuid()),
    modelId: optionalParam(z.uuid()),
    pages: z.coerce
      .number('Saisissez le nombre de pages.')
      .int('Nombre entier de pages.')
      .positive('Au moins une page.')
      .max(10_000_000, 'Nombre de pages trop élevé.'),
    colorPages: z.coerce
      .number('Saisissez le nombre de pages couleur.')
      .int('Nombre entier de pages.')
      .min(0, 'Nombre de pages négatif.'),
    coverage: perChannel(percent('l’aplat')),
    paperFormat: z.enum(PAPER_FORMATS).default('A4'),
    mediaFactor: number('Saisissez le facteur de support.').min(0.1).max(5).default(1),
    /** Appliquer la calibration de la machine choisie. */
    useCalibration: z.boolean().default(true),
  })
  .refine((value) => Boolean(value.printerId) !== Boolean(value.modelId), {
    message: 'Choisissez une machine ou un modèle.',
    path: ['printerId'],
  })
  .refine((value) => value.colorPages <= value.pages, {
    message: 'Les pages couleur ne dépassent pas le total.',
    path: ['colorPages'],
  });

export type TonerSpecInput = z.infer<typeof tonerSpecSchema>;
export type TonerPriceInput = z.infer<typeof tonerPriceSchema>;
export type CalibrationProfileInput = z.infer<typeof calibrationProfileSchema>;
export type MeasurementCreateInput = z.infer<typeof measurementCreateSchema>;
export type ConsumptionQuery = z.infer<typeof consumptionQuerySchema>;
export type SimulationInput = z.infer<typeof simulationSchema>;
