import {
  BILLING_PERIODS,
  CONTRACT_STATUSES,
  INTERVENTION_PRIORITIES,
  INTERVENTION_STATUSES,
  INTERVENTION_TYPES,
  PAPER_FORMATS,
} from '@arksen/shared-types';
import { z } from 'zod';
import { listQuerySchema, nameSchema, optionalText } from './access.js';

const DAY_MS = 86_400_000;
const nonEmpty = (value: object) => Object.keys(value).length > 0;
const NO_CHANGE = 'Aucune modification fournie.';

const optionalParam = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const blankToNull = (value: unknown) =>
  value === '' || value === null || value === undefined ? null : value;

const amount = z.coerce.number('Saisissez un montant.').min(0, 'Montant positif.').max(1e10);
const optionalAmount = z.preprocess(blankToNull, amount.nullable());
const count = (max: number) =>
  z.coerce.number('Saisissez un nombre.').int('Nombre entier.').min(0, '0 minimum.').max(max);
const optionalPositive = (max: number, message: string) =>
  z.preprocess(
    blankToNull,
    z.coerce.number(message).int('Nombre entier.').min(1, '1 minimum.').max(max).nullable(),
  );
const optionalUuid = z.preprocess(blankToNull, z.uuid('Sélection invalide.').nullable());
const isoDate = z.iso.date('Date invalide.');
const pastDateTime = z.iso
  .datetime({ offset: true, message: 'Date invalide.' })
  .refine((value) => Date.parse(value) <= Date.now() + 5 * 60_000, 'Date dans le futur.');
const dateTime = z.iso.datetime({ offset: true, message: 'Date invalide.' });

// ---------------------------------------------------------------------------
// Papier
// ---------------------------------------------------------------------------

const paperTypeFields = z.object({
  name: nameSchema,
  format: z.enum(PAPER_FORMATS, 'Choisissez un format.'),
  grammage: optionalPositive(500, 'Saisissez un grammage.'),
  sheetsPerReam: z.coerce
    .number('Saisissez un nombre de feuilles.')
    .int('Nombre entier.')
    .min(1, '1 minimum.')
    .max(10_000, '10 000 au plus.'),
  reamPrice: optionalAmount,
  notes: optionalText(500),
});

export const paperTypeCreateSchema = paperTypeFields.extend({
  sheetsPerReam: paperTypeFields.shape.sheetsPerReam.default(500),
});
export const paperTypeUpdateSchema = paperTypeFields.partial().refine(nonEmpty, NO_CHANGE);

export const paperStockCreateSchema = z.object({
  siteId: z.uuid('Choisissez un site.'),
  paperTypeId: z.uuid('Choisissez un papier.'),
  minQuantity: count(100_000).default(0),
  leadTimeDays: count(365).default(7),
});

export const paperStockListQuerySchema = listQuerySchema.extend({
  siteId: optionalParam(z.uuid()),
});

// ---------------------------------------------------------------------------
// Coûts
// ---------------------------------------------------------------------------

export const printerCostSettingsSchema = z.object({
  paperTypeId: optionalUuid,
  duplexPercent: z.coerce.number('Saisissez un pourcentage.').min(0).max(100).default(0),
  monthlyFixedCost: optionalAmount,
});

/** Période de calcul des coûts : deux ans au plus. */
export const periodQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    siteId: optionalParam(z.uuid()),
  })
  .refine((value) => value.to >= value.from, {
    message: 'La fin de la période précède son début.',
    path: ['to'],
  })
  .refine((value) => (Date.parse(value.to) - Date.parse(value.from)) / DAY_MS < 731, {
    message: 'Deux ans au plus.',
    path: ['from'],
  });

// ---------------------------------------------------------------------------
// Contrats et relevés de facturation
// ---------------------------------------------------------------------------

const contractFields = z.object({
  reference: z.string().trim().min(1, 'Saisissez une référence.').max(40, '40 caractères maximum.'),
  customerName: nameSchema,
  customerContact: optionalText(200),
  status: z.enum(CONTRACT_STATUSES),
  startDate: isoDate,
  endDate: z.preprocess(blankToNull, isoDate.nullable()),
  billingPeriod: z.enum(BILLING_PERIODS),
  fixedFee: amount,
  includedBlackPages: count(100_000_000),
  includedColorPages: count(100_000_000),
  blackPagePrice: amount,
  colorPagePrice: amount,
  notes: optionalText(1000),
});

const checkDates = (
  value: { startDate?: string; endDate?: string | null },
  context: z.RefinementCtx,
) => {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'La fin précède le début.' });
  }
};

export const contractCreateSchema = contractFields
  .extend({
    status: contractFields.shape.status.default('ACTIVE'),
    billingPeriod: contractFields.shape.billingPeriod.default('MONTHLY'),
    fixedFee: amount.default(0),
    includedBlackPages: count(100_000_000).default(0),
    includedColorPages: count(100_000_000).default(0),
  })
  .superRefine(checkDates);
export const contractUpdateSchema = contractFields
  .partial()
  .refine(nonEmpty, NO_CHANGE)
  .superRefine(checkDates);

export const contractPrintersSchema = z.object({
  printerIds: z.array(z.uuid()).max(1000),
});

export const invoiceCreateSchema = z
  .object({ periodStart: isoDate, periodEnd: isoDate })
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: 'La fin de la période précède son début.',
    path: ['periodEnd'],
  });

export const invoiceListQuerySchema = listQuerySchema.extend({
  contractId: optionalParam(z.uuid()),
});

// ---------------------------------------------------------------------------
// Interventions et maintenance
// ---------------------------------------------------------------------------

export const interventionCreateSchema = z.object({
  printerId: z.uuid('Choisissez une machine.'),
  type: z.enum(INTERVENTION_TYPES).default('CORRECTIVE'),
  priority: z.enum(INTERVENTION_PRIORITIES).default('NORMAL'),
  title: z.string().trim().min(3, 'Décrivez le problème en quelques mots.').max(160),
  description: optionalText(4000),
  scheduledAt: z.preprocess(blankToNull, dateTime.nullable()).optional(),
  assigneeId: z.preprocess(blankToNull, z.string().min(1).max(100).nullable()).optional(),
  planId: optionalUuid.optional(),
});

export const interventionUpdateSchema = z
  .object({
    status: z.enum(INTERVENTION_STATUSES),
    priority: z.enum(INTERVENTION_PRIORITIES),
    title: z.string().trim().min(3).max(160),
    description: optionalText(4000),
    scheduledAt: z.preprocess(blankToNull, dateTime.nullable()),
    assigneeId: z.preprocess(blankToNull, z.string().min(1).max(100).nullable()),
    completedAt: z.preprocess(blankToNull, pastDateTime.nullable()),
    laborMinutes: optionalPositive(100_000, 'Saisissez une durée.'),
    laborCost: optionalAmount,
    partsCost: optionalAmount,
    resolution: optionalText(4000),
  })
  .partial()
  .refine(nonEmpty, NO_CHANGE)
  .superRefine((value, context) => {
    if (value.status === 'DONE' && !value.resolution) {
      context.addIssue({
        code: 'custom',
        path: ['resolution'],
        message: 'Décrivez ce qui a été fait pour clore l’intervention.',
      });
    }
  });

export const interventionListQuerySchema = listQuerySchema.extend({
  status: optionalParam(z.enum([...INTERVENTION_STATUSES, 'ACTIVE'])),
  printerId: optionalParam(z.uuid()),
  type: optionalParam(z.enum(INTERVENTION_TYPES)),
});

const planFields = z.object({
  printerId: z.uuid('Choisissez une machine.'),
  name: nameSchema,
  intervalPages: optionalPositive(100_000_000, 'Saisissez un nombre de pages.'),
  intervalDays: optionalPositive(3650, 'Saisissez un nombre de jours.'),
  active: z.boolean().default(true),
  notes: optionalText(1000),
});

const checkInterval = (
  value: { intervalPages?: number | null; intervalDays?: number | null },
  context: z.RefinementCtx,
) => {
  if (!value.intervalPages && !value.intervalDays) {
    context.addIssue({
      code: 'custom',
      path: ['intervalPages'],
      message: 'Fixez un intervalle en pages, en jours, ou les deux.',
    });
  }
};

export const maintenancePlanCreateSchema = planFields.superRefine(checkInterval);
export const maintenancePlanUpdateSchema = planFields
  .omit({ printerId: true })
  .partial()
  .refine(nonEmpty, NO_CHANGE);

// ---------------------------------------------------------------------------
// Impressions
// ---------------------------------------------------------------------------

export const printJobPrintedSchema = z.object({
  printerId: z.uuid('Choisissez la machine.'),
  copies: z.coerce.number().int().min(1).max(1_000_000),
  salePrice: optionalAmount,
  printedAt: pastDateTime.optional(),
});

export type PaperTypeCreateInput = z.infer<typeof paperTypeCreateSchema>;
export type PaperTypeUpdateInput = z.infer<typeof paperTypeUpdateSchema>;
export type PaperStockCreateInput = z.infer<typeof paperStockCreateSchema>;
export type PaperStockListQuery = z.infer<typeof paperStockListQuerySchema>;
export type PrinterCostSettingsInput = z.infer<typeof printerCostSettingsSchema>;
export type PeriodQuery = z.infer<typeof periodQuerySchema>;
export type ContractCreateInput = z.infer<typeof contractCreateSchema>;
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>;
export type ContractPrintersInput = z.infer<typeof contractPrintersSchema>;
export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;
export type InterventionCreateInput = z.infer<typeof interventionCreateSchema>;
export type InterventionUpdateInput = z.infer<typeof interventionUpdateSchema>;
export type InterventionListQuery = z.infer<typeof interventionListQuerySchema>;
export type MaintenancePlanCreateInput = z.infer<typeof maintenancePlanCreateSchema>;
export type MaintenancePlanUpdateInput = z.infer<typeof maintenancePlanUpdateSchema>;
export type PrintJobPrintedInput = z.infer<typeof printJobPrintedSchema>;
