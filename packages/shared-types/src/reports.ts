import type { Permission } from './access.js';

// =====================================================================
// Phase 10 : rapports exportables et statistiques
// =====================================================================

export const REPORT_FORMATS = ['pdf', 'xlsx', 'csv'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
export const REPORT_FORMAT_LABELS: Record<ReportFormat, string> = {
  pdf: 'PDF',
  xlsx: 'Excel',
  csv: 'CSV',
};

export const REPORT_TYPES = [
  'production',
  'consumption-cmyk',
  'consumption-printer',
  'consumption-client',
  'costs',
  'toner-yield',
  'stocks',
  'maintenance',
  'profitability',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportDefinition {
  title: string;
  description: string;
  /** Droits nécessaires, tous requis. */
  permissions: Permission[];
  /** Faux : le rapport décrit une situation à la date du jour. */
  period: boolean;
}

/** Les rapports du cahier des charges (§ 14), avec les droits qui les ouvrent. */
export const REPORTS: Record<ReportType, ReportDefinition> = {
  production: {
    title: 'Production',
    description: 'Pages imprimées par machine, noir et blanc et couleur.',
    permissions: ['meters:read'],
    period: true,
  },
  'consumption-cmyk': {
    title: 'Consommation CMJN',
    description: 'Toner théorique et estimé par couleur, puis par machine.',
    permissions: ['consumption:read'],
    period: true,
  },
  'consumption-printer': {
    title: 'Consommation par machine',
    description: 'Toner, coût toner et coût toner par page de chaque machine.',
    permissions: ['consumption:read'],
    period: true,
  },
  'consumption-client': {
    title: 'Consommation par client',
    description: 'Pages et toner des machines de chaque contrat client.',
    permissions: ['consumption:read', 'contracts:read'],
    period: true,
  },
  costs: {
    title: 'Coûts d’impression',
    description: 'Toner, papier, interventions, coûts fixes et coût copie.',
    permissions: ['costs:read'],
    period: true,
  },
  'toner-yield': {
    title: 'Rendement toner',
    description: 'Rendement constaté de chaque référence face au rendement constructeur.',
    permissions: ['stocks:read'],
    period: false,
  },
  stocks: {
    title: 'Stocks',
    description: 'Toners et papier : quantités, seuils, couverture et commandes conseillées.',
    permissions: ['stocks:read'],
    period: false,
  },
  maintenance: {
    title: 'Maintenance',
    description: 'Interventions de la période et état des plans de maintenance.',
    permissions: ['interventions:read'],
    period: true,
  },
  profitability: {
    title: 'Rentabilité',
    description: 'Chiffre d’affaires, coût de revient et marge par client et par travail.',
    permissions: ['costs:read', 'contracts:read'],
    period: true,
  },
};

export interface MonthlyStatistic {
  /** AAAA-MM. */
  month: string;
  pages: number;
  colorPages: number;
  tonerCost: number | null;
  totalCost: number;
  costPerPage: number | null;
  /** Chiffre d'affaires des relevés émis dont la période finit ce mois-là. */
  revenue: number;
}

export interface ClientProfitability {
  contractId: string;
  reference: string;
  customerName: string;
  revenue: number;
  cost: number;
  margin: number;
  /** Marge rapportée au chiffre d'affaires, en %. */
  marginRate: number | null;
}

export interface Statistics {
  currency: string;
  months: MonthlyStatistic[];
  /** Machines qui ont le plus imprimé sur la fenêtre. */
  topPrinters: {
    id: string;
    name: string;
    siteName: string;
    pages: number;
    costPerPage: number | null;
  }[];
  clients: ClientProfitability[];
}
