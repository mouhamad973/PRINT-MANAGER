import type { TransactionClient } from '@arksen/database';

/**
 * Numéro suivant d'un compteur propre à l'entreprise (relevés, interventions). L'incrément se
 * fait dans la transaction de l'appelant, sous verrou de ligne : pas de doublon ni de trou
 * tant que la transaction aboutit.
 */
export async function nextNumber(
  tx: TransactionClient,
  tenantId: string,
  name: string,
): Promise<number> {
  const [row] = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO tenant_sequences (tenant_id, name, value) VALUES (${tenantId}::uuid, ${name}, 1)
    ON CONFLICT (tenant_id, name) DO UPDATE SET value = tenant_sequences.value + 1
    RETURNING value`;
  return Number(row!.value);
}
