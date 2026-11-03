/** Mode de déploiement : un seul socle applicatif, configuré par environnement. */
export const DEPLOYMENT_MODES = ['cloud', 'on-premise'] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

/** Rôles applicatifs (le contrôle d'accès est implémenté en Phase 2). */
export const USER_ROLES = [
  'SUPER_ADMIN',
  'CLIENT_ADMIN',
  'PRINT_MANAGER',
  'TECHNICIAN',
  'STOCK_MANAGER',
  'USER',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Canaux toner, toujours calculés indépendamment. */
export const TONER_CHANNELS = ['cyan', 'magenta', 'yellow', 'black'] as const;
export type TonerChannel = (typeof TONER_CHANNELS)[number];

/**
 * Origine d'une valeur de consommation. Ces sources ne doivent jamais être confondues :
 * - `theoretical` : calculée par le moteur CMJN ;
 * - `measured` : pesée ou constatée physiquement ;
 * - `snmp_level` : niveau de toner rapporté par l'équipement ;
 * - `demo` : donnée de démonstration, à afficher comme telle.
 */
export const DATA_ORIGINS = ['theoretical', 'measured', 'snmp_level', 'demo'] as const;
export type DataOrigin = (typeof DATA_ORIGINS)[number];
