import type { ColorMode, PaperFormat } from './fleet.js';
import type { StockLevel, StockMovementType } from './stocks.js';

// =====================================================================
// Phase 9 : papier
// =====================================================================

export interface PaperType {
  id: string;
  name: string;
  format: PaperFormat;
  /** Grammage en g/m². */
  grammage: number | null;
  sheetsPerReam: number;
  reamPrice: number | null;
  /** Prix d'une feuille : prix de la rame divisé par son nombre de feuilles. */
  sheetPrice: number | null;
  currency: string;
  notes: string | null;
  /** Rames en stock, tous sites confondus. */
  stock: number;
  /** Machines qui impriment sur ce papier (réglage des coûts). */
  printers: number;
  createdAt: string;
}

export interface PaperForecast {
  /** Rames consommées par jour, d'après les pages des machines du site sur 90 jours. */
  reamsPerDay: number | null;
  daysOfCover: number | null;
  stockoutAt: string | null;
  recommendedOrder: number;
}

/** Stock d'un papier sur un site, en rames. */
export interface PaperStock {
  id: string;
  site: { id: string; name: string };
  paperType: { id: string; name: string; format: PaperFormat; sheetsPerReam: number };
  quantity: number;
  minQuantity: number;
  leadTimeDays: number;
  level: StockLevel;
  value: number | null;
  currency: string;
  forecast: PaperForecast;
  updatedAt: string;
}

export interface PaperMovement {
  id: string;
  stockId: string;
  type: StockMovementType;
  quantity: number;
  balanceAfter: number;
  unitCost: number | null;
  reference: string | null;
  notes: string | null;
  occurredAt: string;
  createdByEmail: string | null;
}

// =====================================================================
// Coûts d'impression et coût copie
// =====================================================================

/** Réglages de coût d'une machine : son papier, son taux de recto verso, ses coûts fixes. */
export interface PrinterCostSettings {
  printerId: string;
  paperTypeId: string | null;
  /** Part des pages imprimées en recto verso, en pourcentage : deux pages par feuille. */
  duplexPercent: number;
  /** Location, amortissement ou forfait de maintenance, par mois. */
  monthlyFixedCost: number | null;
  updatedAt: string | null;
}

/** Ce qui manque pour un coût complet. */
export const COST_GAPS = ['NO_PAGES', 'NO_TONER_COST', 'NO_PAPER'] as const;
export type CostGap = (typeof COST_GAPS)[number];
export const COST_GAP_LABELS: Record<CostGap, string> = {
  NO_PAGES: 'Aucun relevé sur la période',
  NO_TONER_COST: 'Toners ou prix des toners incomplets',
  NO_PAPER: 'Papier non renseigné',
};

export interface CostBreakdown {
  pages: number;
  colorPages: number;
  blackPages: number;
  /** Coût toner estimé par le moteur CMJN (avec calibration). */
  toner: number | null;
  paper: number | null;
  /** Pièces et main-d'œuvre des interventions terminées sur la période. */
  maintenance: number;
  /** Coûts fixes mensuels, au prorata des jours de la période. */
  fixed: number;
  total: number;
  costPerPage: number | null;
  /** Coût copie : page noir et blanc, et page couleur. */
  costPerBlackPage: number | null;
  costPerColorPage: number | null;
}

export interface PrinterCost extends CostBreakdown {
  printer: { id: string; name: string; siteName: string; colorMode: ColorMode };
  settings: PrinterCostSettings;
  /** Part de la période couverte par des relevés (0 à 1). */
  coverage: number;
  gaps: CostGap[];
}

export interface CostReport {
  from: string;
  to: string;
  currency: string;
  totals: CostBreakdown;
  printers: PrinterCost[];
}

// =====================================================================
// Contrats clients et relevés de facturation
// =====================================================================

export const CONTRACT_STATUSES = ['ACTIVE', 'SUSPENDED', 'TERMINATED'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  ACTIVE: 'En cours',
  SUSPENDED: 'Suspendu',
  TERMINATED: 'Résilié',
};

export const BILLING_PERIODS = ['MONTHLY', 'QUARTERLY'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];
export const BILLING_PERIOD_LABELS: Record<BillingPeriod, string> = {
  MONTHLY: 'Mensuelle',
  QUARTERLY: 'Trimestrielle',
};

export interface Contract {
  id: string;
  reference: string;
  customerName: string;
  customerContact: string | null;
  status: ContractStatus;
  startDate: string;
  endDate: string | null;
  billingPeriod: BillingPeriod;
  /** Forfait de la période de facturation. */
  fixedFee: number;
  includedBlackPages: number;
  includedColorPages: number;
  /** Prix d'une page au-delà des pages incluses. */
  blackPagePrice: number;
  colorPagePrice: number;
  currency: string;
  notes: string | null;
  printers: { id: string; name: string; serialNumber: string; siteName: string }[];
  lastInvoice: {
    id: string;
    number: string | null;
    periodEnd: string;
    status: InvoiceStatus;
  } | null;
  createdAt: string;
}

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Brouillon',
  ISSUED: 'Émis',
  CANCELLED: 'Annulé',
};

export interface InvoiceLine {
  printerId: string;
  name: string;
  serialNumber: string;
  blackPages: number;
  colorPages: number;
  /** Part de la période couverte par des relevés. */
  coverage: number;
}

/** Relevé de facturation d'un contrat : pages relevées, forfait et pages supplémentaires. */
export interface Invoice {
  id: string;
  contract: { id: string; reference: string; customerName: string };
  /** Attribué à l'émission, dans l'ordre : REL-2026-0001. */
  number: string | null;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  blackPages: number;
  colorPages: number;
  includedBlackPages: number;
  includedColorPages: number;
  extraBlackPages: number;
  extraColorPages: number;
  fixedFee: number;
  blackPagePrice: number;
  colorPagePrice: number;
  extraBlackAmount: number;
  extraColorAmount: number;
  totalAmount: number;
  /** Coût de revient des machines sur la période, et la marge qui en résulte. */
  cost: number | null;
  margin: number | null;
  currency: string;
  lines: InvoiceLine[];
  issuedAt: string | null;
  createdAt: string;
  createdByEmail: string | null;
}

// =====================================================================
// Interventions et maintenance préventive
// =====================================================================

export const INTERVENTION_TYPES = ['CORRECTIVE', 'PREVENTIVE', 'INSTALLATION', 'OTHER'] as const;
export type InterventionType = (typeof INTERVENTION_TYPES)[number];
export const INTERVENTION_TYPE_LABELS: Record<InterventionType, string> = {
  CORRECTIVE: 'Dépannage',
  PREVENTIVE: 'Maintenance préventive',
  INSTALLATION: 'Installation',
  OTHER: 'Autre',
};

export const INTERVENTION_STATUSES = [
  'OPEN',
  'SCHEDULED',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
] as const;
export type InterventionStatus = (typeof INTERVENTION_STATUSES)[number];
export const INTERVENTION_STATUS_LABELS: Record<InterventionStatus, string> = {
  OPEN: 'À traiter',
  SCHEDULED: 'Planifiée',
  IN_PROGRESS: 'En cours',
  DONE: 'Terminée',
  CANCELLED: 'Annulée',
};

export const INTERVENTION_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type InterventionPriority = (typeof INTERVENTION_PRIORITIES)[number];
export const INTERVENTION_PRIORITY_LABELS: Record<InterventionPriority, string> = {
  LOW: 'Basse',
  NORMAL: 'Normale',
  HIGH: 'Haute',
  URGENT: 'Urgente',
};

export interface Intervention {
  id: string;
  /** Numéro lisible, propre à l'entreprise. */
  number: number;
  printer: { id: string; name: string; siteName: string };
  type: InterventionType;
  status: InterventionStatus;
  priority: InterventionPriority;
  title: string;
  description: string | null;
  reportedAt: string;
  reportedByEmail: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  assignee: { id: string; name: string } | null;
  /** Compteur total de la machine à la fin de l'intervention. */
  counter: number | null;
  laborMinutes: number | null;
  laborCost: number | null;
  partsCost: number | null;
  totalCost: number | null;
  resolution: string | null;
  plan: { id: string; name: string } | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface Assignee {
  id: string;
  name: string;
  email: string;
  role: string;
}

export const MAINTENANCE_STATES = ['OK', 'DUE_SOON', 'OVERDUE', 'UNKNOWN'] as const;
export type MaintenanceState = (typeof MAINTENANCE_STATES)[number];
export const MAINTENANCE_STATE_LABELS: Record<MaintenanceState, string> = {
  OK: 'À jour',
  DUE_SOON: 'À prévoir',
  OVERDUE: 'Dépassée',
  UNKNOWN: 'Sans relevé',
};

/** Une maintenance est « à prévoir » quand 90 % de son intervalle est atteint. */
export const MAINTENANCE_SOON_RATIO = 0.9;

export interface MaintenancePlan {
  id: string;
  printer: { id: string; name: string; siteName: string };
  name: string;
  intervalPages: number | null;
  intervalDays: number | null;
  active: boolean;
  notes: string | null;
  /** Dernière maintenance faite, ou mise en place du plan. */
  last: { date: string; counter: number | null; interventionId: string | null };
  counter: number | null;
  pagesSince: number | null;
  daysSince: number;
  /** Part de l'intervalle consommée : 1 = échéance atteinte. */
  progress: number | null;
  state: MaintenanceState;
  /** Échéance estimée (au rythme d'impression actuel pour un intervalle en pages). */
  dueAt: string | null;
  openIntervention: { id: string; number: number; status: InterventionStatus } | null;
}

// =====================================================================
// Impressions : travaux réellement imprimés
// =====================================================================

export interface PrintedJob {
  id: string;
  name: string;
  pageCount: number;
  printer: { id: string; name: string } | null;
  copies: number;
  printedAt: string;
  /** Coût de revient : toner (moteur CMJN) et papier. */
  tonerCost: number | null;
  paperCost: number | null;
  cost: number | null;
  salePrice: number | null;
  margin: number | null;
  currency: string;
  printedByEmail: string | null;
}
