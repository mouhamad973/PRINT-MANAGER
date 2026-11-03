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
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const TENANT_BASE: readonly Permission[] = ['tenant:read'];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  CLIENT_ADMIN: [...TENANT_BASE, 'users:read', 'users:manage', 'audit:read'],
  PRINT_MANAGER: [...TENANT_BASE, 'users:read'],
  TECHNICIAN: TENANT_BASE,
  STOCK_MANAGER: TENANT_BASE,
  USER: TENANT_BASE,
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
