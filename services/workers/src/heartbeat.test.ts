import { WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL_SECONDS } from '@arksen/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { publishHeartbeat } from './heartbeat.js';

describe('publishHeartbeat', () => {
  it('écrit l’horodatage avec une durée de vie limitée', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    const now = new Date('2026-11-02T10:00:00.000Z');

    await publishHeartbeat({ set }, now);

    expect(set).toHaveBeenCalledWith(
      WORKER_HEARTBEAT_KEY,
      '2026-11-02T10:00:00.000Z',
      'EX',
      WORKER_HEARTBEAT_TTL_SECONDS,
    );
  });

  it('propage l’erreur pour que BullMQ marque la tâche en échec', async () => {
    const set = vi.fn().mockRejectedValue(new Error('Redis indisponible'));

    await expect(publishHeartbeat({ set })).rejects.toThrow('Redis indisponible');
  });
});
