/** Parc machines : sites, fiches techniques, machines et configuration réseau (Phase 3). */

export const COLOR_MODES = ['COLOR', 'MONOCHROME'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];
export const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  COLOR: 'Couleur',
  MONOCHROME: 'Noir et blanc',
};

export const PRINT_TECHNOLOGIES = ['LASER', 'LED', 'INKJET', 'OTHER'] as const;
export type PrintTechnology = (typeof PRINT_TECHNOLOGIES)[number];
export const PRINT_TECHNOLOGY_LABELS: Record<PrintTechnology, string> = {
  LASER: 'Laser',
  LED: 'LED',
  INKJET: 'Jet d’encre',
  OTHER: 'Autre',
};

export const PAPER_FORMATS = ['A4', 'A3', 'SRA3'] as const;
export type PaperFormat = (typeof PAPER_FORMATS)[number];

/** État d'exploitation, déclaré par les utilisateurs. */
export const PRINTER_STATUSES = ['ACTIVE', 'MAINTENANCE', 'OUT_OF_SERVICE', 'RETIRED'] as const;
export type PrinterStatus = (typeof PRINTER_STATUSES)[number];
export const PRINTER_STATUS_LABELS: Record<PrinterStatus, string> = {
  ACTIVE: 'En service',
  MAINTENANCE: 'En maintenance',
  OUT_OF_SERVICE: 'Hors service',
  RETIRED: 'Retirée du parc',
};

/** Joignabilité réseau, mesurée par l'agent de collecte (Phase 7). Jamais déduite ni simulée. */
export const CONNECTIVITY_STATUSES = ['UNKNOWN', 'ONLINE', 'OFFLINE'] as const;
export type ConnectivityStatus = (typeof CONNECTIVITY_STATUSES)[number];
export const CONNECTIVITY_LABELS: Record<ConnectivityStatus, string> = {
  UNKNOWN: 'Non mesurée',
  ONLINE: 'En ligne',
  OFFLINE: 'Hors ligne',
};

export const SNMP_VERSIONS = ['V1', 'V2C', 'V3'] as const;
export type SnmpVersion = (typeof SNMP_VERSIONS)[number];
export const SNMP_VERSION_LABELS: Record<SnmpVersion, string> = {
  V1: 'SNMPv1',
  V2C: 'SNMPv2c',
  V3: 'SNMPv3',
};

export const SNMP_SECURITY_LEVELS = ['NO_AUTH_NO_PRIV', 'AUTH_NO_PRIV', 'AUTH_PRIV'] as const;
export type SnmpSecurityLevel = (typeof SNMP_SECURITY_LEVELS)[number];
export const SNMP_SECURITY_LEVEL_LABELS: Record<SnmpSecurityLevel, string> = {
  NO_AUTH_NO_PRIV: 'Sans authentification ni chiffrement',
  AUTH_NO_PRIV: 'Authentification sans chiffrement',
  AUTH_PRIV: 'Authentification et chiffrement',
};

export const SNMP_AUTH_PROTOCOLS = ['MD5', 'SHA', 'SHA224', 'SHA256', 'SHA384', 'SHA512'] as const;
export type SnmpAuthProtocol = (typeof SNMP_AUTH_PROTOCOLS)[number];

export const SNMP_PRIV_PROTOCOLS = ['DES', 'AES128', 'AES192', 'AES256'] as const;
export type SnmpPrivProtocol = (typeof SNMP_PRIV_PROTOCOLS)[number];

export interface Site {
  id: string;
  tenantId: string;
  name: string;
  code: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  printerCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Fiche technique d'un modèle. `tenantId` nul : catalogue Arksen, partagé par toutes les entreprises. */
export interface PrinterModel {
  id: string;
  tenantId: string | null;
  manufacturer: string;
  name: string;
  colorMode: ColorMode;
  technology: PrintTechnology;
  maxFormat: PaperFormat;
  speedMonoPpm: number | null;
  speedColorPpm: number | null;
  duplex: boolean;
  monthlyDutyCycle: number | null;
  recommendedVolume: number | null;
  notes: string | null;
  printerCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Configuration réseau telle que l'expose l'API. Les secrets SNMP n'en sortent jamais :
 * seule leur présence est indiquée.
 */
export interface PrinterConnection {
  ipAddress: string | null;
  hostname: string | null;
  macAddress: string | null;
  snmpVersion: SnmpVersion;
  snmpPort: number;
  hasCommunity: boolean;
  snmpUsername: string | null;
  snmpSecurityLevel: SnmpSecurityLevel | null;
  snmpAuthProtocol: SnmpAuthProtocol | null;
  hasAuthPassword: boolean;
  snmpPrivProtocol: SnmpPrivProtocol | null;
  hasPrivPassword: boolean;
  updatedAt: string;
}

export interface Printer {
  id: string;
  tenantId: string;
  name: string;
  serialNumber: string;
  assetTag: string | null;
  location: string | null;
  status: PrinterStatus;
  connectivity: ConnectivityStatus;
  lastSeenAt: string | null;
  installedAt: string | null;
  notes: string | null;
  site: Pick<Site, 'id' | 'name'>;
  model: Pick<
    PrinterModel,
    'id' | 'manufacturer' | 'name' | 'colorMode' | 'maxFormat' | 'tenantId'
  >;
  /** Adresse réseau principale, si elle est configurée. */
  address: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrinterDetail extends Printer {
  connection: PrinterConnection | null;
}

/** Tableau de bord du parc : uniquement des comptages réels, aucune valeur estimée. */
export interface FleetDashboard {
  totals: {
    printers: number;
    sites: number;
    color: number;
    monochrome: number;
    /** Machines dont l'adresse réseau est renseignée : prêtes pour la collecte. */
    networkConfigured: number;
  };
  byStatus: Record<PrinterStatus, number>;
  byConnectivity: Record<ConnectivityStatus, number>;
  bySite: { siteId: string; name: string; count: number }[];
  byManufacturer: { manufacturer: string; count: number }[];
  /** Machines qui demandent une action : hors service, en maintenance ou sans adresse réseau. */
  attention: (Pick<Printer, 'id' | 'name' | 'status' | 'address'> & { siteName: string })[];
}
