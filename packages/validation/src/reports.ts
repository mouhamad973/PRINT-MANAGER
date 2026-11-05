import { REPORT_FORMATS } from '@arksen/shared-types';
import { z } from 'zod';

const DAY_MS = 86_400_000;
const optionalParam = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** Export d'un rapport : format et, pour un rapport de période, deux ans au plus. */
export const reportQuerySchema = z
  .object({
    format: z.enum(REPORT_FORMATS).default('pdf'),
    from: optionalParam(z.iso.date('Date de début invalide.')),
    to: optionalParam(z.iso.date('Date de fin invalide.')),
    siteId: optionalParam(z.uuid()),
  })
  .refine((value) => !value.from || !value.to || value.to >= value.from, {
    message: 'La fin de la période précède son début.',
    path: ['to'],
  })
  .refine(
    (value) =>
      !value.from || !value.to || (Date.parse(value.to) - Date.parse(value.from)) / DAY_MS < 731,
    { message: 'Deux ans au plus.', path: ['from'] },
  );

export const statisticsQuerySchema = z.object({
  months: z.coerce.number().int().min(3).max(12).default(6),
  siteId: optionalParam(z.uuid()),
});

export const auditExportQuerySchema = z
  .object({
    from: z.iso.date('Date de début invalide.'),
    to: z.iso.date('Date de fin invalide.'),
  })
  .refine((value) => value.to >= value.from, {
    message: 'La fin de la période précède son début.',
    path: ['to'],
  });

export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type StatisticsQuery = z.infer<typeof statisticsQuerySchema>;
export type AuditExportQuery = z.infer<typeof auditExportQuerySchema>;
