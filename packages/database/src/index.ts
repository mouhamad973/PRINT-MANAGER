import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/prisma/client.js';

export { Prisma, PrismaClient };
export type {
  AuditLog,
  Tenant,
  TenantStatus,
  User,
  UserRole,
  UserStatus,
} from './generated/prisma/client.js';

/** Client Prisma d'une transaction : ce que reçoit le code exécuté sous RLS. */
export type TransactionClient = Prisma.TransactionClient;

/** Crée un client Prisma. La connexion n'est ouverte qu'à la première requête. */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exécute `work` dans une transaction où PostgreSQL ne laisse voir que les lignes de `tenantId`.
 * Les politiques RLS lisent `app.tenant_id`, défini ici pour la seule durée de la transaction :
 * une connexion rendue au pool ne garde jamais le contexte d'une autre entreprise.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  work: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new Error('Identifiant d’entreprise invalide');
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return work(tx);
  });
}
