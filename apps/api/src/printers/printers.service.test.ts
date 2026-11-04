import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { printerConnectionSchema } from '@arksen/validation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import { SecretBox } from '../common/secret-box.js';
import { PrintersService } from './printers.service.js';

const TENANT = '0190f0a0-0000-7000-8000-00000000000a';
const PRINTER = '0190f0a0-0000-7000-8000-000000000001';
const actor: Principal = {
  userId: 'tech-1',
  email: 'tech@a.test',
  name: 'Tech',
  role: 'TECHNICIAN',
  tenantId: TENANT,
  sessionId: 's',
};
const context = { ipAddress: '10.0.0.1', userAgent: 'test' };
const now = new Date('2026-11-04T10:00:00Z');
const box = new SecretBox('ab'.repeat(32));

function printerRow(connection: Record<string, unknown> | null) {
  return {
    id: PRINTER,
    tenantId: TENANT,
    name: 'Accueil',
    serialNumber: 'SN-1',
    assetTag: null,
    location: null,
    status: 'ACTIVE',
    connectivity: 'UNKNOWN',
    lastSeenAt: null,
    installedAt: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    site: { id: 'site', name: 'Siège' },
    model: {
      id: 'model',
      manufacturer: 'F',
      name: 'M',
      colorMode: 'COLOR',
      maxFormat: 'A4',
      tenantId: null,
    },
    connection: connection && { updatedAt: now, ...connection },
  };
}

const tx = {
  $executeRaw: vi.fn(),
  printer: { findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
  printerConnection: { upsert: vi.fn() },
};
const appPrisma = { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) };
const audit = { record: vi.fn() };
const service = new PrintersService(appPrisma as never, box, audit as unknown as AuditService);

/** Données passées à l'upsert de la configuration réseau. */
function savedData() {
  return tx.printerConnection.upsert.mock.calls[0]![0].update as Record<string, unknown>;
}

function connect(input: Record<string, unknown>) {
  return service.setConnection(
    TENANT,
    PRINTER,
    printerConnectionSchema.parse(input),
    actor,
    context,
  );
}

describe('PrintersService : configuration réseau', () => {
  let stored: Record<string, unknown> | null;

  beforeEach(() => {
    vi.clearAllMocks();
    stored = null;
    tx.printer.findFirst.mockImplementation(async () => ({
      ...printerRow(null),
      connection: stored,
    }));
    tx.printerConnection.upsert.mockImplementation(async ({ update }) => {
      stored = update;
    });
    tx.printer.findFirstOrThrow.mockImplementation(async () => printerRow(stored));
  });

  it('chiffre la communauté et ne la renvoie jamais', async () => {
    const result = await connect({
      ipAddress: '10.0.0.20',
      snmpVersion: 'V2C',
      snmpCommunity: 'lecture',
    });

    const community = savedData().snmpCommunity as string;
    expect(community).toMatch(/^v1\./);
    expect(box.decrypt(community, `printer:${PRINTER}:snmpCommunity`)).toBe('lecture');
    expect(result.connection).toMatchObject({ hasCommunity: true, ipAddress: '10.0.0.20' });
    expect(JSON.stringify(result)).not.toContain(community);
    expect(JSON.stringify(result)).not.toContain('lecture');
  });

  it('conserve un secret absent de la requête et le signale au journal sans sa valeur', async () => {
    await connect({ ipAddress: '10.0.0.20', snmpVersion: 'V2C', snmpCommunity: 'lecture' });
    const first = savedData().snmpCommunity;
    vi.clearAllMocks();

    await connect({ ipAddress: '10.0.0.21', snmpVersion: 'V2C' });

    expect(savedData().snmpCommunity).toBe(first);
    const metadata = audit.record.mock.calls[0]![0].metadata;
    expect(metadata.changedSecrets).toEqual([]);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('lecture');
  });

  it('exige la communauté en SNMPv1 et v2c', async () => {
    await expect(connect({ ipAddress: '10.0.0.20', snmpVersion: 'V2C' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('efface la communauté et chiffre les mots de passe lors du passage à SNMPv3', async () => {
    await connect({ ipAddress: '10.0.0.20', snmpVersion: 'V2C', snmpCommunity: 'lecture' });
    vi.clearAllMocks();

    await connect({
      ipAddress: '10.0.0.20',
      snmpVersion: 'V3',
      snmpUsername: 'collecteur',
      snmpSecurityLevel: 'AUTH_PRIV',
      snmpAuthProtocol: 'SHA256',
      snmpAuthPassword: 'motdepasse-auth',
      snmpPrivProtocol: 'AES128',
      snmpPrivPassword: 'motdepasse-priv',
    });

    const data = savedData();
    expect(data.snmpCommunity).toBeNull();
    expect(
      box.decrypt(data.snmpAuthPassword as string, `printer:${PRINTER}:snmpAuthPassword`),
    ).toBe('motdepasse-auth');
    expect(audit.record.mock.calls[0]![0].metadata.changedSecrets).toEqual([
      'snmpCommunity',
      'snmpAuthPassword',
      'snmpPrivPassword',
    ]);
  });

  it('n’enregistre que les secrets exigés par le niveau de sécurité SNMPv3', async () => {
    await connect({
      ipAddress: '10.0.0.20',
      snmpVersion: 'V3',
      snmpUsername: 'collecteur',
      snmpSecurityLevel: 'AUTH_NO_PRIV',
      snmpAuthProtocol: 'SHA',
      snmpAuthPassword: 'motdepasse-auth',
      snmpPrivProtocol: 'AES256',
      snmpPrivPassword: 'ignore-moi',
    });

    expect(savedData()).toMatchObject({ snmpPrivProtocol: null, snmpPrivPassword: null });
  });

  it('refuse d’effacer un mot de passe SNMPv3 exigé', async () => {
    await expect(
      connect({
        ipAddress: '10.0.0.20',
        snmpVersion: 'V3',
        snmpUsername: 'collecteur',
        snmpSecurityLevel: 'AUTH_NO_PRIV',
        snmpAuthProtocol: 'SHA',
        snmpAuthPassword: null,
      }),
    ).rejects.toThrow('Saisissez le mot de passe d’authentification.');
  });

  it('répond 404 pour une machine invisible dans le contexte de l’entreprise', async () => {
    tx.printer.findFirst.mockResolvedValue(null);
    await expect(
      connect({ ipAddress: '10.0.0.20', snmpVersion: 'V2C', snmpCommunity: 'x' }),
    ).rejects.toThrow(NotFoundException);
    expect(tx.printerConnection.upsert).not.toHaveBeenCalled();
  });
});
