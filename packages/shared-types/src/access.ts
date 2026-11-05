import type { UserRole } from './domain.js';

/**
 * Catalogue des permissions. Chaque phase ajoute celles de ses modules.
 * La matrice est définie dans le code, et non en base : une politique de sécurité
 * modifiable à l'exécution serait une surface d'attaque sans besoin métier identifié.
 */
export const PERMISSIONS = [
  /** Lire et gérer toutes les entreprises clientes (plateforme). */
  'platform:tenants:manage',
  /** Consulter le journal d'audit de la plateforme entière. */
  'platform:audit:read',
  /** Consulter la fiche de sa propre entreprise. */
  'tenant:read',
  /** Consulter les utilisateurs de l'entreprise. */
  'users:read',
  /** Créer, modifier et désactiver les utilisateurs de l'entreprise. */
  'users:manage',
  /** Consulter le journal d'audit de l'entreprise. */
  'audit:read',
  /** Gérer le catalogue Arksen des fiches techniques, partagé par toutes les entreprises. */
  'platform:catalog:manage',
  /** Administrer le système : conservation des données, export du journal d'audit. */
  'platform:system:manage',
  /** Consulter les sites de l'entreprise. */
  'sites:read',
  /** Créer, modifier et supprimer les sites. */
  'sites:manage',
  /** Consulter le parc machines, les fiches techniques et le tableau de bord. */
  'printers:read',
  /** Ajouter et modifier les machines, et changer leur statut. */
  'printers:manage',
  /** Modifier la configuration réseau et les secrets SNMP des machines. */
  'printers:network:manage',
  /** Créer et modifier les fiches techniques propres à l'entreprise. */
  'printer-models:manage',
  /** Consulter les compteurs, les volumes et les anomalies. */
  'meters:read',
  /** Saisir, importer et supprimer des relevés de compteurs. */
  'meters:manage',
  /** Consulter la consommation toner, les coûts et la calibration. */
  'consumption:read',
  /** Régler la calibration, saisir les consommations réelles et les prix des toners. */
  'consumption:manage',
  /** Consulter les fichiers analysés et leurs rapports de préproduction. */
  'print-jobs:read',
  /** Importer et analyser des fichiers PDF. */
  'print-jobs:manage',
  /** Consulter les agents de collecte, leurs synchronisations et les équipements découverts. */
  'agents:read',
  /** Enregistrer, renouveler et révoquer les agents ; associer les équipements découverts. */
  'agents:manage',
  /** Consulter les toners, les stocks, les mouvements et les prévisions. */
  'stocks:read',
  /** Réceptionner, sortir, inventorier et transférer les toners ; régler les seuils. */
  'stocks:manage',
  /** Enregistrer et annuler les remplacements de toner sur les machines. */
  'toner-replacements:manage',
  /** Consulter les alertes. */
  'alerts:read',
  /** Prendre en compte et clôturer les alertes. */
  'alerts:manage',
  /** Consulter les coûts d'impression et le coût copie. */
  'costs:read',
  /** Régler les coûts des machines : papier, recto verso, coûts fixes. */
  'costs:manage',
  /** Consulter les contrats clients et leurs relevés de facturation. */
  'contracts:read',
  /** Gérer les contrats, établir et émettre les relevés de facturation. */
  'contracts:manage',
  /** Consulter les interventions et les plans de maintenance. */
  'interventions:read',
  /** Signaler une panne : ouvrir une intervention. */
  'interventions:report',
  /** Planifier, affecter, conduire et clore les interventions ; gérer la maintenance préventive. */
  'interventions:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const TENANT_BASE: readonly Permission[] = [
  'tenant:read',
  'sites:read',
  'printers:read',
  'meters:read',
];

const FLEET_MANAGEMENT: readonly Permission[] = [
  'sites:manage',
  'printers:manage',
  'printers:network:manage',
  'printer-models:manage',
  'meters:manage',
  'consumption:read',
  'consumption:manage',
  'print-jobs:read',
  'print-jobs:manage',
  'agents:read',
  'agents:manage',
  'stocks:read',
  'stocks:manage',
  'toner-replacements:manage',
  'alerts:read',
  'alerts:manage',
  'costs:read',
  'costs:manage',
  'contracts:read',
  'contracts:manage',
  'interventions:read',
  'interventions:report',
  'interventions:manage',
];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  CLIENT_ADMIN: [...TENANT_BASE, 'users:read', 'users:manage', 'audit:read', ...FLEET_MANAGEMENT],
  PRINT_MANAGER: [...TENANT_BASE, 'users:read', ...FLEET_MANAGEMENT],
  TECHNICIAN: [
    ...TENANT_BASE,
    'printers:manage',
    'printers:network:manage',
    'meters:manage',
    'consumption:read',
    'consumption:manage',
    'print-jobs:read',
    'print-jobs:manage',
    'agents:read',
    'agents:manage',
    'stocks:read',
    'toner-replacements:manage',
    'alerts:read',
    'alerts:manage',
    'interventions:read',
    'interventions:report',
    'interventions:manage',
  ],
  STOCK_MANAGER: [
    ...TENANT_BASE,
    'consumption:read',
    'print-jobs:read',
    'stocks:read',
    'stocks:manage',
    'toner-replacements:manage',
    'alerts:read',
    'alerts:manage',
    'costs:read',
    'interventions:read',
    'interventions:report',
  ],
  USER: [...TENANT_BASE, 'interventions:read', 'interventions:report'],
};

/** Libellés des permissions d'entreprise, pour la matrice des rôles. */
export const PERMISSION_LABELS: Partial<Record<Permission, string>> = {
  'tenant:read': 'Consulter l’entreprise',
  'sites:read': 'Consulter les sites',
  'sites:manage': 'Gérer les sites',
  'printers:read': 'Consulter le parc et le tableau de bord',
  'printers:manage': 'Gérer les machines et leur statut',
  'printers:network:manage': 'Configurer le réseau et SNMP',
  'printer-models:manage': 'Gérer les fiches techniques',
  'meters:read': 'Consulter les compteurs et les volumes',
  'meters:manage': 'Saisir et importer les relevés',
  'consumption:read': 'Consulter la consommation et les coûts toner',
  'consumption:manage': 'Calibrer et saisir les consommations réelles',
  'print-jobs:read': 'Consulter les analyses PDF',
  'print-jobs:manage': 'Analyser des fichiers PDF',
  'agents:read': 'Consulter les agents de collecte',
  'agents:manage': 'Enregistrer et révoquer les agents de collecte',
  'stocks:read': 'Consulter les toners, les stocks et les prévisions',
  'stocks:manage': 'Gérer les stocks de toner et leurs seuils',
  'toner-replacements:manage': 'Enregistrer les remplacements de toner',
  'alerts:read': 'Consulter les alertes',
  'alerts:manage': 'Prendre en compte et clôturer les alertes',
  'costs:read': 'Consulter les coûts d’impression',
  'costs:manage': 'Régler les coûts des machines',
  'contracts:read': 'Consulter les contrats et la facturation',
  'contracts:manage': 'Gérer les contrats et émettre les relevés',
  'interventions:read': 'Consulter les interventions et la maintenance',
  'interventions:report': 'Signaler une panne',
  'interventions:manage': 'Conduire les interventions et la maintenance',
  'users:read': 'Voir les utilisateurs',
  'users:manage': 'Gérer les utilisateurs',
  'audit:read': 'Consulter le journal d’audit',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Administrateur Arksen',
  CLIENT_ADMIN: 'Administrateur client',
  PRINT_MANAGER: 'Responsable impression',
  TECHNICIAN: 'Technicien',
  STOCK_MANAGER: 'Gestionnaire de stock',
  USER: 'Utilisateur',
};

/** Rôles qu'un administrateur d'entreprise peut attribuer. Le Super Administrateur n'en fait pas partie. */
export const TENANT_ROLES = [
  'CLIENT_ADMIN',
  'PRINT_MANAGER',
  'TECHNICIAN',
  'STOCK_MANAGER',
  'USER',
] as const satisfies readonly UserRole[];
export type TenantRole = (typeof TENANT_ROLES)[number];

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
}

export interface Tenant extends TenantSummary {
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  /** Devise des prix et des coûts (ISO 4217). */
  currency: string;
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Réponse de `GET /api/v1/me` : l'identité et les droits, établis par le serveur. */
export interface CurrentUser {
  user: Pick<UserAccount, 'id' | 'name' | 'email' | 'role'>;
  tenant: TenantSummary | null;
  permissions: Permission[];
}

export interface AuditLogEntry {
  id: string;
  tenantId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
