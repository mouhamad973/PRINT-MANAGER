import type { SupplyForecast } from './stocks.js';
import type {
  ColorMode,
  SnmpAuthProtocol,
  SnmpPrivProtocol,
  SnmpSecurityLevel,
  SnmpVersion,
} from './fleet.js';

// =====================================================================
// Agents de collecte (Phase 7)
// =====================================================================

export const AGENT_STATUSES = ['PENDING', 'ACTIVE', 'REVOKED'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  PENDING: 'En attente d’enregistrement',
  ACTIVE: 'Enregistré',
  REVOKED: 'Révoqué',
};

/** Un agent est « connecté » s'il a contacté le serveur depuis moins de ce délai. */
export const AGENT_ONLINE_WINDOW_MS = 30 * 60 * 1000;

/** Durée de validité d'un code d'enregistrement. */
export const ENROLLMENT_CODE_TTL_MS = 24 * 60 * 60 * 1000;

/** Agent de collecte tel que l'expose l'API. Ni son jeton ni son code ne sont jamais renvoyés. */
export interface CollectorAgent {
  id: string;
  tenantId: string;
  name: string;
  site: { id: string; name: string } | null;
  status: AgentStatus;
  /** Code d'enregistrement en attente : seule son échéance est connue. */
  enrollmentExpiresAt: string | null;
  hostname: string | null;
  version: string | null;
  platform: string | null;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  online: boolean;
  /** Événements reçus depuis 24 heures, et parmi eux ceux rejetés. */
  events24h: number;
  rejected24h: number;
  enrolledAt: string | null;
  revokedAt: string | null;
  createdByEmail: string | null;
  createdAt: string;
}

/** Réponse à la création d'un agent ou au renouvellement de son code : le code n'est montré qu'une fois. */
export interface AgentEnrollmentCode {
  agent: CollectorAgent;
  enrollmentCode: string;
  expiresAt: string;
}

/** Synchronisation reçue d'un agent : un lot d'événements. */
export interface AgentSyncLog {
  id: string;
  agentId: string;
  agentName: string;
  receivedAt: string;
  received: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  durationMs: number;
}

export const AGENT_EVENT_TYPES = ['meter.reading', 'printer.status', 'device.discovered'] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];
export const AGENT_EVENT_TYPE_LABELS: Record<AgentEventType, string> = {
  'meter.reading': 'Relevé de compteurs',
  'printer.status': 'État de la machine',
  'device.discovered': 'Équipement découvert',
};

/** Événement rejeté par le serveur : l'agent le garde, marqué rejeté, et ne le renvoie plus. */
export interface RejectedAgentEvent {
  id: string;
  agentId: string;
  agentName: string;
  /** Type annoncé par l'agent, éventuellement inconnu du serveur. */
  type: string;
  printerId: string | null;
  printerName: string | null;
  occurredAt: string;
  receivedAt: string;
  error: string;
}

/** Équipement répondant en SNMP trouvé par une découverte réseau. */
export interface DiscoveredDevice {
  id: string;
  agentId: string;
  agentName: string;
  ipAddress: string;
  serialNumber: string | null;
  sysName: string | null;
  description: string | null;
  macAddress: string | null;
  /** Machine du parc correspondante : même numéro de série, ou associée à la main. */
  printer: { id: string; name: string } | null;
  ignored: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

// =====================================================================
// État SNMP d'une machine
// =====================================================================

/** hrDeviceStatus (RFC 2790). */
export const DEVICE_STATUSES = ['unknown', 'running', 'warning', 'testing', 'down'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];
export const DEVICE_STATUS_LABELS: Record<DeviceStatus, string> = {
  unknown: 'Inconnu',
  running: 'En fonctionnement',
  warning: 'Avertissement',
  testing: 'En test',
  down: 'Hors service',
};

/** hrPrinterStatus (RFC 2790). */
export const PRINTER_ACTIVITIES = ['other', 'unknown', 'idle', 'printing', 'warmup'] as const;
export type PrinterActivity = (typeof PRINTER_ACTIVITIES)[number];
export const PRINTER_ACTIVITY_LABELS: Record<PrinterActivity, string> = {
  other: 'Autre',
  unknown: 'Inconnue',
  idle: 'En attente',
  printing: 'Impression en cours',
  warmup: 'Préchauffage',
};

/** Bits de hrPrinterDetectedErrorState (RFC 2790 et RFC 3805), dans l'ordre. */
export const PRINTER_ALERTS = [
  'lowPaper',
  'noPaper',
  'lowToner',
  'noToner',
  'doorOpen',
  'jammed',
  'offline',
  'serviceRequested',
  'inputTrayMissing',
  'outputTrayMissing',
  'markerSupplyMissing',
  'outputNearFull',
  'outputFull',
  'inputTrayEmpty',
  'overduePreventMaint',
] as const;
export type PrinterAlert = (typeof PRINTER_ALERTS)[number];
export const PRINTER_ALERT_LABELS: Record<PrinterAlert, string> = {
  lowPaper: 'Papier bientôt épuisé',
  noPaper: 'Plus de papier',
  lowToner: 'Toner bientôt épuisé',
  noToner: 'Toner épuisé',
  doorOpen: 'Capot ouvert',
  jammed: 'Bourrage papier',
  offline: 'Hors ligne',
  serviceRequested: 'Intervention demandée',
  inputTrayMissing: 'Bac d’alimentation absent',
  outputTrayMissing: 'Bac de sortie absent',
  markerSupplyMissing: 'Consommable absent',
  outputNearFull: 'Bac de sortie presque plein',
  outputFull: 'Bac de sortie plein',
  inputTrayEmpty: 'Bac d’alimentation vide',
  overduePreventMaint: 'Maintenance préventive dépassée',
};

/** Consommable lu dans prtMarkerSuppliesTable (RFC 3805). */
export interface SupplyLevel {
  index: number;
  description: string;
  /** Type de consommable Printer-MIB : toner, tonerCartridge, opc, fuser… */
  kind: string;
  /** Canal CMJN reconnu d'après le colorant ou la description, sinon nul. */
  channel: 'CYAN' | 'MAGENTA' | 'YELLOW' | 'BLACK' | null;
  /**
   * Niveau en pourcentage de la capacité, quand la machine le donne. Origine `snmp_level` :
   * c'est un niveau déclaré par la machine, jamais une consommation mesurée.
   */
  levelPercent: number | null;
}

export interface PrinterSnmpState {
  printerId: string;
  agent: { id: string; name: string };
  observedAt: string;
  reachable: boolean;
  error: string | null;
  deviceStatus: DeviceStatus | null;
  printerStatus: PrinterActivity | null;
  alerts: PrinterAlert[];
  supplies: SupplyLevel[];
  /** Compteur total d'impressions (prtMarkerLifeCount), quand la machine le donne. */
  totalCount: number | null;
  serialNumber: string | null;
  description: string | null;
  /** Épuisement prévu de chaque cartouche, d'après l'historique de ses niveaux. */
  forecasts: SupplyForecast[];
}

// =====================================================================
// Protocole agent ↔ serveur, version 1
// =====================================================================

export const AGENT_SCHEMA_VERSION = 1;
export const AGENT_MAX_BATCH = 200;

/** Configuration SNMP d'une machine envoyée à son agent : seul endroit où les secrets sont déchiffrés. */
export interface AgentPrinterTarget {
  id: string;
  name: string;
  serialNumber: string;
  colorMode: ColorMode;
  host: string;
  snmp: {
    version: SnmpVersion;
    port: number;
    community: string | null;
    username: string | null;
    securityLevel: SnmpSecurityLevel | null;
    authProtocol: SnmpAuthProtocol | null;
    authPassword: string | null;
    privProtocol: SnmpPrivProtocol | null;
    privPassword: string | null;
  };
  /** OID des compteurs : le total est standard (Printer-MIB), noir et couleur dépendent du constructeur. */
  counters: { totalOid: string; blackOid: string | null; colorOid: string | null };
}

export interface AgentConfiguration {
  agent: { id: string; name: string; tenantId: string; siteId: string | null };
  printers: AgentPrinterTarget[];
  serverTime: string;
}

export interface AgentEnrollment {
  agentId: string;
  tenantId: string;
  name: string;
  /** Jeton secret de l'agent : à conserver, il n'est délivré qu'une fois. */
  token: string;
}

export type AgentAckStatus = 'accepted' | 'duplicate' | 'rejected';

export interface AgentAck {
  id: string;
  status: AgentAckStatus;
  error?: string;
}

export interface AgentEventsResult {
  acks: AgentAck[];
  serverTime: string;
}
