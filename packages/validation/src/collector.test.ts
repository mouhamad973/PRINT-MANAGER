import { describe, expect, it } from 'vitest';
import {
  agentCreateSchema,
  agentEnrollSchema,
  agentEventSchema,
  agentEventsBatchSchema,
  optionalOidSchema,
} from './collector.js';
import { printerModelCreateSchema } from './fleet.js';

const AGENT = '0195f5c4-1f2a-7c3e-9a51-0e3f4a5b6c7d';
const PRINTER = '0195f5c4-1f2a-7c3e-9a51-0e3f4a5b6c7e';

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: '0195f5c4-1f2a-7c3e-9a51-0e3f4a5b6c70',
    type: 'meter.reading',
    schemaVersion: 1,
    agentId: AGENT,
    printerId: PRINTER,
    occurredAt: '2026-11-06T08:00:00.000Z',
    payload: { totalCount: 1520, blackCount: 1000, colorCount: 520 },
    ...overrides,
  };
}

describe('protocole des agents', () => {
  it('accepte un événement complet de chaque type', () => {
    expect(agentEventSchema.safeParse(event()).success).toBe(true);
    expect(
      agentEventSchema.safeParse(
        event({
          type: 'printer.status',
          payload: {
            reachable: true,
            deviceStatus: 'warning',
            alerts: ['lowToner'],
            supplies: [
              { index: 1, description: 'Toner', kind: 'toner', channel: 'BLACK', levelPercent: 41 },
            ],
          },
        }),
      ).success,
    ).toBe(true);
    expect(
      agentEventSchema.safeParse(
        event({ type: 'device.discovered', printerId: null, payload: { ipAddress: '10.0.0.12' } }),
      ).success,
    ).toBe(true);
  });

  it('refuse une version de schéma inconnue, un type inconnu ou un compteur négatif', () => {
    expect(agentEventSchema.safeParse(event({ schemaVersion: 2 })).success).toBe(false);
    expect(agentEventSchema.safeParse(event({ type: 'printer.reboot' })).success).toBe(false);
    expect(agentEventSchema.safeParse(event({ payload: { totalCount: -1 } })).success).toBe(false);
    expect(
      agentEventSchema.safeParse(
        event({ type: 'printer.status', payload: { reachable: true, alerts: ['inconnue'] } }),
      ).success,
    ).toBe(false);
    expect(agentEventSchema.safeParse(event({ occurredAt: '06/11/2026' })).success).toBe(false);
  });

  it('n’exige du lot que l’identifiant de chaque événement', () => {
    // Un événement mal formé n'invalide pas le lot : il sera rejeté seul, avec sa raison.
    expect(
      agentEventsBatchSchema.safeParse({ events: [event(), { id: event().id, type: 'x' }] })
        .success,
    ).toBe(true);
    expect(agentEventsBatchSchema.safeParse({ events: [{ type: 'x' }] }).success).toBe(false);
    expect(agentEventsBatchSchema.safeParse({ events: [] }).success).toBe(false);
    expect(
      agentEventsBatchSchema.safeParse({ events: Array.from({ length: 201 }, () => event()) })
        .success,
    ).toBe(false);
  });

  it('lit un code d’enregistrement saisi librement', () => {
    const parsed = agentEnrollSchema.parse({
      code: 'abcd-efgh 2345-6723',
      hostname: 'POSTE',
      version: '0.1.0',
    });
    expect(parsed.code).toBe('ABCDEFGH23456723');
    expect(
      agentEnrollSchema.safeParse({ code: 'ABCD-EFGH', hostname: 'P', version: '1' }).success,
    ).toBe(false);
  });

  it('crée un agent avec ou sans site', () => {
    expect(agentCreateSchema.parse({ name: 'Siège', siteId: '' })).toEqual({
      name: 'Siège',
      siteId: null,
    });
  });
});

describe('OID des compteurs', () => {
  it('accepte un OID numérique, avec ou sans point initial, et vide comme absent', () => {
    expect(optionalOidSchema.parse('.1.3.6.1.4.1.99999.2.1.0')).toBe('1.3.6.1.4.1.99999.2.1.0');
    expect(optionalOidSchema.parse('')).toBeNull();
    expect(optionalOidSchema.safeParse('1.3.6').success).toBe(false);
    expect(optionalOidSchema.safeParse('iso.3.6.1.2.1.1').success).toBe(false);
  });

  it('refuse un compteur couleur sur un modèle noir et blanc', () => {
    const result = printerModelCreateSchema.safeParse({
      manufacturer: 'M',
      name: 'N',
      colorMode: 'MONOCHROME',
      snmpColorCounterOid: '1.3.6.1.4.1.99999.2.2.0',
    });
    expect(result.success).toBe(false);
  });
});
