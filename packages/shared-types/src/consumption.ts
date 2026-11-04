/** Consommation toner CMJN (Phase 5). */

import type { ColorMode, PaperFormat } from './fleet.js';

/** Canaux toner, toujours calculés indépendamment. */
export const CMYK_CHANNELS = ['CYAN', 'MAGENTA', 'YELLOW', 'BLACK'] as const;
export type CmykChannel = (typeof CMYK_CHANNELS)[number];
export const CMYK_LABELS: Record<CmykChannel, string> = {
  CYAN: 'Cyan',
  MAGENTA: 'Magenta',
  YELLOW: 'Jaune',
  BLACK: 'Noir',
};

/** Canaux d'une machine selon son mode d'impression. */
export function channelsFor(colorMode: ColorMode): readonly CmykChannel[] {
  return colorMode === 'COLOR' ? CMYK_CHANNELS : ['BLACK'];
}

/** Couverture de référence des rendements constructeur (ISO/IEC 19752 et 19798), en pourcentage. */
export const ISO_REFERENCE_COVERAGE = 5;

export const CURRENCIES = ['XOF', 'XAF', 'EUR', 'USD', 'MAD', 'CAD', 'CHF', 'GBP'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface TonerSpec {
  id: string;
  printerModelId: string;
  /** Nul : toner du catalogue Arksen. */
  tenantId: string | null;
  channel: CmykChannel;
  reference: string;
  capacityGrams: number;
  yieldPages: number;
  referenceCoverage: number;
  /** Prix d'achat d'une cartouche pour l'entreprise, ou `null` s'il n'est pas renseigné. */
  unitPrice: number | null;
}

export interface CalibrationProfile {
  printerId: string;
  /** Aplat moyen supposé des impressions, en pourcentage, par canal. */
  coverage: Record<CmykChannel, number>;
  paperFormat: PaperFormat;
  mediaFactor: number;
  /** Coefficients saisis à la main ; `null` : calibration automatique. */
  manualCoefficients: Record<CmykChannel, number | null>;
  /** Vrai tant que la machine utilise les paramètres par défaut. */
  isDefault: boolean;
}

export const CALIBRATION_SOURCES = ['manual', 'printer', 'model', 'default'] as const;
export type CalibrationSource = (typeof CALIBRATION_SOURCES)[number];
export const CALIBRATION_SOURCE_LABELS: Record<CalibrationSource, string> = {
  manual: 'Saisi à la main',
  printer: 'Mesures de la machine',
  model: 'Mesures du modèle',
  default: 'Par défaut',
};

export type CalibrationConfidence = 'none' | 'low' | 'medium' | 'high';
export const CONFIDENCE_LABELS: Record<CalibrationConfidence, string> = {
  none: 'Aucune mesure',
  low: 'Faible',
  medium: 'Moyenne',
  high: 'Élevée',
};

export interface Calibration {
  coefficient: number;
  source: CalibrationSource;
  observations: number;
  confidence: CalibrationConfidence;
}

export const MEASUREMENT_METHODS = ['WEIGHING', 'CARTRIDGES'] as const;
export type MeasurementMethod = (typeof MEASUREMENT_METHODS)[number];
export const MEASUREMENT_METHOD_LABELS: Record<MeasurementMethod, string> = {
  WEIGHING: 'Pesée (mesurée)',
  CARTRIDGES: 'Cartouches vidées (estimée)',
};

export interface PagesCount {
  total: number;
  color: number;
  /** Part de la période couverte par des relevés de compteurs. */
  coverage: number;
}

/** Consommation réelle d'un canal sur une période, et son écart avec le théorique. */
export interface ConsumptionMeasurement {
  id: string;
  printerId: string;
  channel: CmykChannel;
  periodStart: string;
  periodEnd: string;
  method: MeasurementMethod;
  grams: number;
  cartridges: number | null;
  notes: string | null;
  createdByEmail: string | null;
  createdAt: string;
  pages: PagesCount;
  /** `null` si le théorique ne peut pas être calculé (toner non renseigné). */
  theoreticalGrams: number | null;
  deviationGrams: number | null;
  deviationRatio: number | null;
  overconsumptionRatio: number | null;
}

export interface ChannelConsumption {
  channel: CmykChannel;
  relevantPages: number;
  coverage: number;
  referenceGramsPerPage: number;
  /** Consommation théorique : le moteur, sans calibration. */
  theoreticalGrams: number;
  /** Consommation estimée : la théorique corrigée par le coefficient de calibration. */
  estimatedGrams: number;
  estimatedGramsPer1000Pages: number;
  calibration: Calibration;
  costTheoretical: number | null;
  costEstimated: number | null;
}

export interface ConsumptionTotals {
  theoreticalGrams: number;
  estimatedGrams: number;
  costTheoretical: number | null;
  costEstimated: number | null;
  costPerPage: number | null;
  /** Faux si un prix manque : les coûts sont partiels. */
  completeCost: boolean;
}

/** Raison pour laquelle une machine n'a pas de consommation calculée. */
export type ConsumptionGap = 'NO_TONER_SPECS' | 'NO_PAGES';
export const CONSUMPTION_GAP_LABELS: Record<ConsumptionGap, string> = {
  NO_TONER_SPECS: 'Toners de la fiche technique non renseignés',
  NO_PAGES: 'Aucune page connue sur la période',
};

export interface PrinterConsumption {
  printerId: string;
  name: string;
  siteName: string;
  colorMode: ColorMode;
  pages: PagesCount;
  gap: ConsumptionGap | null;
  channels: ChannelConsumption[];
  totals: ConsumptionTotals | null;
}

export interface FleetConsumption {
  from: string;
  to: string;
  currency: string;
  channels: {
    channel: CmykChannel;
    theoreticalGrams: number;
    estimatedGrams: number;
    costEstimated: number | null;
  }[];
  totals: ConsumptionTotals & { pages: number };
  printers: PrinterConsumption[];
}

export interface PrinterConsumptionDetail extends PrinterConsumption {
  from: string;
  to: string;
  currency: string;
  profile: CalibrationProfile;
  toners: TonerSpec[];
  measurements: ConsumptionMeasurement[];
}

/** Simulation d'un travail : l'aplat de chaque canal et un nombre de pages. */
export interface ConsumptionSimulation {
  currency: string;
  pages: number;
  colorPages: number;
  channels: ChannelConsumption[];
  totals: ConsumptionTotals;
}
