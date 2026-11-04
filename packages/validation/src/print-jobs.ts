import { z } from 'zod';
import { listQuerySchema } from './access.js';

export const MAX_COPIES = 1_000_000;

const copies = z.coerce
  .number('Saisissez le nombre d’exemplaires.')
  .int('Nombre entier d’exemplaires.')
  .min(1, 'Au moins un exemplaire.')
  .max(MAX_COPIES, `${MAX_COPIES.toLocaleString('fr-FR')} exemplaires maximum.`);

const optionalUuid = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.uuid('Machine invalide.').optional(),
);

/** Champs qui accompagnent le fichier envoyé (formulaire multipart : tout arrive en texte). */
export const printJobUploadSchema = z.object({
  printerId: optionalUuid,
  copies: copies.default(1),
});

export const printJobUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'Saisissez un nom.').max(200, '200 caractères maximum.'),
    /** `null` retire la machine prévue. */
    printerId: z.uuid('Machine invalide.').nullable(),
    copies,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Aucune modification fournie.');

export const printJobEstimateQuerySchema = z.object({
  printerId: z.uuid('Choisissez une machine.'),
  copies: copies.optional(),
  useCalibration: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value !== 'false'),
});

export const printJobListQuerySchema = listQuerySchema;

export type PrintJobUploadInput = z.infer<typeof printJobUploadSchema>;
export type PrintJobUpdateInput = z.infer<typeof printJobUpdateSchema>;
export type PrintJobEstimateQuery = z.infer<typeof printJobEstimateQuerySchema>;
