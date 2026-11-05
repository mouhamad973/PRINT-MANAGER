import type { CmykChannel } from './consumption.js';

// =====================================================================
// Toners et stocks (Phase 8)
// =====================================================================

export const STOCK_MOVEMENT_TYPES = [
  'RECEIPT',
  'ISSUE',
  'INSTALLATION',
  'CANCELLATION',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  RECEIPT: 'Réception',
  ISSUE: 'Sortie',
  INSTALLATION: 'Installation sur une machine',
  CANCELLATION: 'Annulation d’une installation',
  ADJUSTMENT: 'Inventaire',
  TRANSFER_OUT: 'Transfert sortant',
  TRANSFER_IN: 'Transfert entrant',
};

/** Mouvements saisis directement ; les autres naissent d'un remplacement ou d'un transfert. */
export const MANUAL_MOVEMENT_TYPES = ['RECEIPT', 'ISSUE', 'ADJUSTMENT'] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export const STOCK_LEVELS = ['OK', 'LOW', 'OUT'] as const;
export type StockLevel = (typeof STOCK_LEVELS)[number];
export const STOCK_LEVEL_LABELS: Record<StockLevel, string> = {
  OK: 'Suffisant',
  LOW: 'Sous le seuil',
  OUT: 'Rupture',
};

/** Méthode d'une prévision : le moteur CMJN (pages et aplat) ou l'historique des installations. */
export const FORECAST_METHODS = ['engine', 'history', 'none'] as const;
export type ForecastMethod = (typeof FORECAST_METHODS)[number];

/** Fenêtre d'observation des prévisions de consommation. */
export const FORECAST_WINDOW_DAYS = 90;

export interface StockForecast {
  method: ForecastMethod;
  /** Cartouches consommées par jour sur la fenêtre d'observation. */
  cartridgesPerDay: number | null;
  /** Jours avant rupture au rythme actuel ; nul si aucune consommation n'est observée. */
  daysOfCover: number | null;
  stockoutAt: string | null;
  /** Quantité à commander pour couvrir le délai de réapprovisionnement et 30 jours. */
  recommendedOrder: number;
}

/** Article de stock : une référence de toner sur un site. */
export interface TonerStock {
  id: string;
  site: { id: string; name: string };
  reference: string;
  channel: CmykChannel;
  /** Modèles qui utilisent cette référence. */
  models: string[];
  /** Machines du site équipées de cette référence. */
  printers: number;
  quantity: number;
  minQuantity: number;
  leadTimeDays: number;
  level: StockLevel;
  /** Valeur du stock au dernier coût de réception connu, sinon au prix du toner. */
  unitCost: number | null;
  value: number | null;
  /** Devise de l'entreprise. */
  currency: string;
  forecast: StockForecast;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  stockId: string;
  type: StockMovementType;
  /** Signé : positif pour une entrée, négatif pour une sortie. */
  quantity: number;
  balanceAfter: number;
  unitCost: number | null;
  reference: string | null;
  notes: string | null;
  replacementId: string | null;
  printer: { id: string; name: string } | null;
  occurredAt: string;
  createdByEmail: string | null;
}

/** Référence de toner connue de l'entreprise, d'après ses fiches techniques. */
export interface TonerReference {
  reference: string;
  channel: CmykChannel;
  capacityGrams: number;
  yieldPages: number;
  models: { id: string; name: string }[];
  /** Machines du parc équipées de cette référence. */
  printers: number;
  unitPrice: number | null;
  currency: string;
  /** Stock total, tous sites confondus. */
  stock: number;
  replacements90d: number;
  /** Rendement moyen constaté entre deux remplacements, en pages ; nul sans mesure. */
  averageYield: number | null;
  yieldSamples: number;
}

export interface TonerReplacement {
  id: string;
  printer: { id: string; name: string; siteName: string };
  channel: CmykChannel;
  reference: string | null;
  replacedAt: string;
  previousLevelPercent: number | null;
  /** Compteur de la machine (noir, ou couleur pour C, M et J) au remplacement. */
  counter: number | null;
  /** Pages imprimées par la cartouche précédente : rendement réel. */
  pagesSincePrevious: number | null;
  yieldPages: number | null;
  stock: { id: string; siteName: string } | null;
  notes: string | null;
  createdByEmail: string | null;
}

/** Remontée du niveau d'une cartouche vue par l'agent, sans remplacement enregistré. */
export interface DetectedReplacement {
  printer: { id: string; name: string };
  channel: CmykChannel;
  detectedAt: string;
  levelBefore: number;
  levelAfter: number;
}

/** Épuisement prévu d'une cartouche d'après l'évolution de son niveau SNMP. */
export interface SupplyForecast {
  channel: CmykChannel;
  levelPercent: number;
  /** Points de pourcentage consommés par jour ; nul sans tendance mesurable. */
  percentPerDay: number | null;
  emptyAt: string | null;
}

// =====================================================================
// Alertes
// =====================================================================

export const ALERT_TYPES = [
  'STOCK_LOW',
  'STOCK_OUT',
  'STOCK_FORECAST',
  'TONER_LOW',
  'TONER_EMPTY',
  'PAPER_LOW',
  'PAPER_OUT',
  'MAINTENANCE_DUE',
  'MAINTENANCE_OVERDUE',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  STOCK_LOW: 'Stock sous le seuil',
  STOCK_OUT: 'Rupture de stock',
  STOCK_FORECAST: 'Rupture prévue',
  TONER_LOW: 'Toner bientôt épuisé',
  TONER_EMPTY: 'Toner épuisé',
  PAPER_LOW: 'Papier sous le seuil',
  PAPER_OUT: 'Rupture de papier',
  MAINTENANCE_DUE: 'Maintenance à prévoir',
  MAINTENANCE_OVERDUE: 'Maintenance dépassée',
};

export const ALERT_SEVERITIES = ['WARNING', 'CRITICAL'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = {
  OPEN: 'Ouverte',
  ACKNOWLEDGED: 'Prise en compte',
  RESOLVED: 'Résolue',
};

/** Seuils des niveaux SNMP, en pourcentage. */
export const TONER_LOW_PERCENT = 10;
export const TONER_EMPTY_PERCENT = 2;

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  printer: { id: string; name: string } | null;
  stockId: string | null;
  site: { id: string; name: string } | null;
  channel: CmykChannel | null;
  paperStockId: string | null;
  planId: string | null;
  openedAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  acknowledgedByEmail: string | null;
  resolvedAt: string | null;
  /** `auto` : la condition a disparu ; `manual` : clôturée par un utilisateur. */
  resolution: 'auto' | 'manual' | null;
}

export interface AlertSummary {
  open: number;
  critical: number;
  byType: Record<AlertType, number>;
  /** Articles sous le seuil ou en rupture. */
  criticalStocks: (Pick<
    TonerStock,
    'id' | 'reference' | 'channel' | 'quantity' | 'minQuantity' | 'level'
  > & { siteName: string })[];
}
