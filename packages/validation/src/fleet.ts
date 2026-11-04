import {
  COLOR_MODES,
  PAPER_FORMATS,
  PRINT_TECHNOLOGIES,
  PRINTER_STATUSES,
  SNMP_AUTH_PROTOCOLS,
  SNMP_PRIV_PROTOCOLS,
  SNMP_SECURITY_LEVELS,
  SNMP_VERSIONS,
} from '@arksen/shared-types';
import { z } from 'zod';
import { listQuerySchema, nameSchema, optionalText } from './access.js';
import { optionalOidSchema } from './collector.js';

/** Paramètre d'URL facultatif : une valeur vide équivaut à son absence. */
const optionalParam = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** Entier facultatif saisi dans un formulaire : vide devient `null`. */
const optionalInt = (min: number, max: number) =>
  z.preprocess(
    (value) =>
      value === '' || value === null || value === undefined || Number.isNaN(value)
        ? null
        : Number(value),
    z
      .number('Saisissez un nombre.')
      .int('Saisissez un nombre entier.')
      .min(min, `${min} minimum.`)
      .max(max, `${max.toLocaleString('fr-FR')} maximum.`)
      .nullable(),
  );

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .nullish()
  .transform((value) => (value ? value : null))
  .pipe(z.email('Saisissez une adresse e-mail valide.').nullable());

const requiredText = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max, `${max} caractères maximum.`);

const nonEmpty = (value: object) => Object.keys(value).length > 0;
const NO_CHANGE = 'Aucune modification fournie.';

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

const siteFields = {
  name: nameSchema,
  code: optionalText(30),
  address: optionalText(200),
  postalCode: optionalText(20),
  city: optionalText(100),
  country: optionalText(100),
  contactName: optionalText(120),
  contactEmail: optionalEmail,
  contactPhone: optionalText(40),
  notes: optionalText(1000),
};

export const siteCreateSchema = z.object(siteFields);
export const siteUpdateSchema = z.object(siteFields).partial().refine(nonEmpty, NO_CHANGE);

// ---------------------------------------------------------------------------
// Fiches techniques
// ---------------------------------------------------------------------------

const printerModelFields = z.object({
  manufacturer: requiredText(80, 'Saisissez le fabricant.'),
  name: requiredText(120, 'Saisissez le nom du modèle.'),
  colorMode: z.enum(COLOR_MODES, 'Choisissez couleur ou noir et blanc.'),
  technology: z.enum(PRINT_TECHNOLOGIES),
  maxFormat: z.enum(PAPER_FORMATS),
  speedMonoPpm: optionalInt(1, 500),
  speedColorPpm: optionalInt(1, 500),
  duplex: z.boolean(),
  monthlyDutyCycle: optionalInt(1, 10_000_000),
  recommendedVolume: optionalInt(1, 10_000_000),
  /** Compteurs propres au constructeur, lus par l'agent de collecte (le total suit la Printer-MIB). */
  snmpBlackCounterOid: optionalOidSchema,
  snmpColorCounterOid: optionalOidSchema,
  notes: optionalText(1000),
});

/** Une machine noir et blanc n'a ni vitesse ni compteur couleur. */
function checkColorSpeed(
  value: { colorMode?: string; speedColorPpm?: number | null; snmpColorCounterOid?: string | null },
  context: z.RefinementCtx,
) {
  if (value.colorMode === 'MONOCHROME' && value.speedColorPpm) {
    context.addIssue({
      code: 'custom',
      path: ['speedColorPpm'],
      message: 'Un modèle noir et blanc n’a pas de vitesse couleur.',
    });
  }
  if (value.colorMode === 'MONOCHROME' && value.snmpColorCounterOid) {
    context.addIssue({
      code: 'custom',
      path: ['snmpColorCounterOid'],
      message: 'Un modèle noir et blanc n’a pas de compteur couleur.',
    });
  }
}

export const printerModelCreateSchema = printerModelFields
  .extend({
    technology: z.enum(PRINT_TECHNOLOGIES).default('LASER'),
    maxFormat: z.enum(PAPER_FORMATS).default('A4'),
    duplex: z.boolean().default(true),
  })
  .superRefine(checkColorSpeed);

export const printerModelUpdateSchema = printerModelFields
  .partial()
  .refine(nonEmpty, NO_CHANGE)
  .superRefine(checkColorSpeed);

export const printerModelListQuerySchema = listQuerySchema.extend({
  colorMode: optionalParam(z.enum(COLOR_MODES)),
  /** `catalog` : catalogue Arksen ; `tenant` : modèles propres à l'entreprise. */
  scope: optionalParam(z.enum(['catalog', 'tenant'])),
});

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

const printerFields = z.object({
  siteId: z.uuid('Choisissez un site.'),
  modelId: z.uuid('Choisissez un modèle.'),
  name: nameSchema,
  serialNumber: requiredText(80, 'Saisissez le numéro de série.'),
  assetTag: optionalText(60),
  location: optionalText(120),
  status: z.enum(PRINTER_STATUSES),
  installedAt: z
    .string()
    .trim()
    .nullish()
    .transform((value) => (value ? value : null))
    .pipe(z.iso.date('Saisissez une date valide.').nullable()),
  notes: optionalText(1000),
});

export const printerCreateSchema = printerFields.extend({
  status: z.enum(PRINTER_STATUSES).default('ACTIVE'),
});

export const printerUpdateSchema = printerFields.partial().refine(nonEmpty, NO_CHANGE);

export const printerListQuerySchema = listQuerySchema.extend({
  siteId: optionalParam(z.uuid()),
  modelId: optionalParam(z.uuid()),
  status: optionalParam(z.enum(PRINTER_STATUSES)),
  colorMode: optionalParam(z.enum(COLOR_MODES)),
});

export const fleetDashboardQuerySchema = z.object({
  siteId: optionalParam(z.uuid()),
  colorMode: optionalParam(z.enum(COLOR_MODES)),
});

// ---------------------------------------------------------------------------
// Configuration réseau et SNMP
// ---------------------------------------------------------------------------

const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const MAC_PATTERN = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}$/i;

/** Adresse MAC normalisée : six octets en majuscules, séparés par deux-points. */
function normalizeMac(value: string): string {
  return value
    .replace(/[^0-9a-f]/gi, '')
    .toUpperCase()
    .match(/.{2}/g)!
    .join(':');
}

/**
 * Secret en écriture seule : absent, il est conservé ; `null`, il est effacé ; une chaîne le remplace.
 * Le serveur ne le renvoie jamais.
 */
const secretInput = (min: number, max: number, label: string) =>
  z
    .string()
    .min(min, `${label} : ${min} caractères minimum.`)
    .max(max, `${label} : ${max} caractères maximum.`)
    .nullable()
    .optional();

export const printerConnectionSchema = z
  .object({
    ipAddress: z
      .string()
      .trim()
      .nullish()
      .transform((value) => (value ? value : null))
      .pipe(z.union([z.ipv4(), z.ipv6()], 'Saisissez une adresse IPv4 ou IPv6 valide.').nullable()),
    hostname: z
      .string()
      .trim()
      .toLowerCase()
      .nullish()
      .transform((value) => (value ? value : null))
      .pipe(z.string().regex(HOSTNAME_PATTERN, 'Saisissez un nom d’hôte valide.').nullable()),
    macAddress: z
      .string()
      .trim()
      .nullish()
      .transform((value) => (value ? value : null))
      .pipe(
        z
          .string()
          .regex(MAC_PATTERN, 'Saisissez une adresse MAC valide (ex. 00:1B:44:11:3A:B7).')
          .transform(normalizeMac)
          .nullable(),
      ),
    snmpVersion: z.enum(SNMP_VERSIONS),
    snmpPort: z.coerce
      .number('Saisissez un port.')
      .int('Saisissez un port entier.')
      .min(1, 'Port compris entre 1 et 65535.')
      .max(65535, 'Port compris entre 1 et 65535.')
      .default(161),
    snmpCommunity: secretInput(1, 64, 'Communauté'),
    snmpUsername: optionalText(64),
    snmpSecurityLevel: z.enum(SNMP_SECURITY_LEVELS).nullish(),
    snmpAuthProtocol: z.enum(SNMP_AUTH_PROTOCOLS).nullish(),
    // SNMPv3 (RFC 3414) impose au moins 8 caractères pour les mots de passe.
    snmpAuthPassword: secretInput(8, 64, 'Mot de passe d’authentification'),
    snmpPrivProtocol: z.enum(SNMP_PRIV_PROTOCOLS).nullish(),
    snmpPrivPassword: secretInput(8, 64, 'Mot de passe de chiffrement'),
  })
  .superRefine((value, context) => {
    if (!value.ipAddress && !value.hostname) {
      context.addIssue({
        code: 'custom',
        path: ['ipAddress'],
        message: 'Saisissez une adresse IP ou un nom d’hôte.',
      });
    }
    if (value.snmpVersion !== 'V3') {
      return;
    }
    if (!value.snmpUsername) {
      context.addIssue({
        code: 'custom',
        path: ['snmpUsername'],
        message: 'SNMPv3 exige un nom d’utilisateur.',
      });
    }
    if (!value.snmpSecurityLevel) {
      context.addIssue({
        code: 'custom',
        path: ['snmpSecurityLevel'],
        message: 'Choisissez un niveau de sécurité.',
      });
    }
    const level = value.snmpSecurityLevel;
    if ((level === 'AUTH_NO_PRIV' || level === 'AUTH_PRIV') && !value.snmpAuthProtocol) {
      context.addIssue({
        code: 'custom',
        path: ['snmpAuthProtocol'],
        message: 'Choisissez un protocole d’authentification.',
      });
    }
    if (level === 'AUTH_PRIV' && !value.snmpPrivProtocol) {
      context.addIssue({
        code: 'custom',
        path: ['snmpPrivProtocol'],
        message: 'Choisissez un protocole de chiffrement.',
      });
    }
  });

export type SiteCreateInput = z.infer<typeof siteCreateSchema>;
export type SiteUpdateInput = z.infer<typeof siteUpdateSchema>;
export type PrinterModelCreateInput = z.infer<typeof printerModelCreateSchema>;
export type PrinterModelUpdateInput = z.infer<typeof printerModelUpdateSchema>;
export type PrinterModelListQuery = z.infer<typeof printerModelListQuerySchema>;
export type PrinterCreateInput = z.infer<typeof printerCreateSchema>;
export type PrinterUpdateInput = z.infer<typeof printerUpdateSchema>;
export type PrinterListQuery = z.infer<typeof printerListQuerySchema>;
export type FleetDashboardQuery = z.infer<typeof fleetDashboardQuerySchema>;
export type PrinterConnectionInput = z.infer<typeof printerConnectionSchema>;
