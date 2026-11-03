import { describe, expect, it } from 'vitest';
import {
  CRITICAL_DEPENDENCIES,
  DEPENDENCY_NAMES,
  TONER_CHANNELS,
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_HEARTBEAT_TTL_SECONDS,
} from './index.js';

describe('contrats partagés', () => {
  it('définit les quatre canaux toner', () => {
    expect(TONER_CHANNELS).toEqual(['cyan', 'magenta', 'yellow', 'black']);
  });

  it('ne déclare critiques que des dépendances connues', () => {
    for (const name of CRITICAL_DEPENDENCIES) {
      expect(DEPENDENCY_NAMES).toContain(name);
    }
  });

  it('laisse le heartbeat des workers survivre à au moins un cycle manqué', () => {
    // Le TTL doit couvrir deux intervalles pour éviter les faux « down ».
    expect(WORKER_HEARTBEAT_TTL_SECONDS).toBeGreaterThanOrEqual(
      (WORKER_HEARTBEAT_INTERVAL_MS * 2) / 1000,
    );
  });
});
