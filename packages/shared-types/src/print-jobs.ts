/** Analyse PDF et travaux d'impression (Phase 6). */

import type { ChannelConsumption, CmykChannel, ConsumptionTotals } from './consumption.js';
import type { ColorMode } from './fleet.js';

export const ORIENTATION_LABELS: Record<string, string> = {
  portrait: 'Portrait',
  landscape: 'Paysage',
  square: 'Carré',
};

/** Couverture d'encre, en pourcentage de la surface : moyenne de la valeur de teinte de chaque canal. */
export interface Coverage {
  cyan: number;
  magenta: number;
  yellow: number;
  black: number;
}

export interface PrintJobPage {
  number: number;
  widthMm: number;
  heightMm: number;
  /** A4, A3, SRA3, A5, Letter, Legal, Tabloid ou « Personnalisé ». */
  format: string;
  orientation: 'portrait' | 'landscape' | 'square';
  /** Surface rapportée à une page A4. */
  areaFactor: number;
  coverage: Coverage;
  /** Couverture de noir si la page est imprimée en niveaux de gris. */
  grayCoverage: number;
  isColor: boolean;
}

export interface PrintJobSummary {
  id: string;
  name: string;
  fileSize: number;
  pageCount: number;
  colorPages: number;
  /** Couverture moyenne du document, pondérée par la surface des pages. */
  averageCoverage: Coverage;
  printer: { id: string; name: string } | null;
  copies: number;
  createdByEmail: string | null;
  createdAt: string;
}

export interface PrintJob extends PrintJobSummary {
  fileSha256: string;
  /** Méthode de rendu et de séparation qui a produit les mesures. */
  method: string;
  dpi: number;
  /** Nombre de pages par format, pour le résumé. */
  formats: { format: string; pages: number }[];
  pages: PrintJobPage[];
}

/** Estimation du toner d'un travail sur une machine : le rapport de préproduction. */
export interface PrintJobEstimate {
  printer: { id: string; name: string; colorMode: ColorMode };
  copies: number;
  currency: string;
  /** Pages du travail converties en surfaces A4, exemplaires compris. */
  a4EquivalentPages: number;
  /** Vrai si la machine imprime en noir et blanc : les pages couleur passent en niveaux de gris. */
  grayscale: boolean;
  channels: ChannelConsumption[];
  totals: ConsumptionTotals;
  costPerCopy: number | null;
  /** Toner estimé de chaque page, pour un exemplaire. */
  pages: { number: number; grams: Partial<Record<CmykChannel, number>>; totalGrams: number }[];
}
