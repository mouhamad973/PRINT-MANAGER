import { WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL_SECONDS } from '@arksen/shared-types';

interface HeartbeatStore {
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

/**
 * Publie la preuve que les workers traitent bien des tâches BullMQ. La clé expire seule :
 * si les workers s'arrêtent, l'API les signale absents sans qu'aucun signal d'arrêt soit nécessaire.
 */
export async function publishHeartbeat(store: HeartbeatStore, now = new Date()): Promise<void> {
  await store.set(WORKER_HEARTBEAT_KEY, now.toISOString(), 'EX', WORKER_HEARTBEAT_TTL_SECONDS);
}
