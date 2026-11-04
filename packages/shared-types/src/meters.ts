/** Compteurs et volumes d'impression (Phase 4). */

import type { ColorMode, PrinterStatus } from './fleet.js';

/** Origine d'un relevé. `AGENT` est réservé à l'agent de collecte (Phase 7). */
export const METER_SOURCES = ['MANUAL', 'IMPORT', 'AGENT'] as const;
export type MeterSource = (typeof METER_SOURCES)[number];
export const METER_SOURCE_LABELS: Record<MeterSource, string> = {
  MANUAL: 'Saisie',
  IMPORT: 'Import',
  AGENT: 'Agent',
};

export const ANOMALY_CODES = [
  'COUNTER_DECREASE',
  'VOLUME_SPIKE',
  'ABOVE_DUTY_CYCLE',
  'NO_ACTIVITY',
  'NO_RECENT_READING',
] as const;
export type AnomalyCode = (typeof ANOMALY_CODES)[number];
export const ANOMALY_LABELS: Record<AnomalyCode, string> = {
  COUNTER_DECREASE: 'Compteur en baisse',
  VOLUME_SPIKE: 'Pic de volume',
  ABOVE_DUTY_CYCLE: 'Au-delà du volume constructeur',
  NO_ACTIVITY: 'Aucune impression',
  NO_RECENT_READING: 'Relevé manquant',
};

export type AnomalySeverity = 'danger' | 'warning' | 'info';
export const ANOMALY_SEVERITIES: Record<AnomalyCode, AnomalySeverity> = {
  COUNTER_DECREASE: 'danger',
  VOLUME_SPIKE: 'warning',
  ABOVE_DUTY_CYCLE: 'warning',
  NO_ACTIVITY: 'info',
  NO_RECENT_READING: 'info',
};

/** Anomalie détectée sur l'historique d'une machine. */
export interface MeterAnomaly {
  code: AnomalyCode;
  severity: AnomalySeverity;
  /** Explication rédigée pour l'utilisateur, avec les valeurs en cause. */
  message: string;
  /** Relevé qui révèle l'anomalie, s'il y en a un. */
  readingId: string | null;
  detectedAt: string;
}

export interface FleetMeterAnomaly extends MeterAnomaly {
  printerId: string;
  printerName: string;
  siteName: string;
}

export interface MeterReading {
  id: string;
  printerId: string;
  readAt: string;
  blackCount: number;
  /** Nul pour une machine noir et blanc. */
  colorCount: number | null;
  totalCount: number;
  /** Le compteur a été remis à zéro ou remplacé : pas de volume calculé avec le relevé précédent. */
  isReset: boolean;
  source: MeterSource;
  notes: string | null;
  createdByEmail: string | null;
  createdAt: string;
  /** Pages depuis le relevé précédent, ou `null` si elles ne peuvent pas être calculées. */
  delta: { black: number; color: number; total: number } | null;
  anomalies: MeterAnomaly[];
}

export const VOLUME_GRANULARITIES = ['day', 'month'] as const;
export type VolumeGranularity = (typeof VOLUME_GRANULARITIES)[number];

/**
 * Pages imprimées. Entre deux relevés, le volume est réparti à parts égales dans le temps :
 * `coverage` dit quelle part de la période est couverte par des relevés (1 = entièrement).
 */
export interface VolumeTotals {
  black: number;
  color: number;
  total: number;
  coverage: number;
}

export interface VolumePoint extends VolumeTotals {
  /** `AAAA-MM-JJ` par jour, `AAAA-MM` par mois (UTC). */
  period: string;
}

export const COMPARISONS = ['previous', 'year'] as const;
export type Comparison = (typeof COMPARISONS)[number];
export const COMPARISON_LABELS: Record<Comparison, string> = {
  previous: 'période précédente',
  year: 'même période l’an dernier',
};

export interface PrinterVolume {
  printerId: string;
  name: string;
  siteName: string;
  colorMode: ColorMode;
  status: PrinterStatus;
  lastReadingAt: string | null;
  current: VolumeTotals;
  previous: VolumeTotals;
}

export interface FleetVolumes {
  from: string;
  to: string;
  granularity: VolumeGranularity;
  comparison: { kind: Comparison; from: string; to: string };
  totals: VolumeTotals;
  previousTotals: VolumeTotals;
  series: VolumePoint[];
  byPrinter: PrinterVolume[];
}

export interface PrinterVolumes {
  from: string;
  to: string;
  granularity: VolumeGranularity;
  totals: VolumeTotals;
  series: VolumePoint[];
}

export interface MeterImportResult {
  created: number;
  /** Lignes déjà présentes (même machine et même date) : ignorées, l'import peut être rejoué. */
  duplicates: number;
  errors: { row: number; message: string }[];
}
