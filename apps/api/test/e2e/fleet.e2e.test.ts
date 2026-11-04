import { createPrismaClient, withTenant, type PrismaClient } from '@arksen/database';
import type {
  FleetDashboard,
  Page,
  PrinterDetail,
  PrinterModel,
  Site,
  Tenant,
  UserAccount,
} from '@arksen/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, requireEnv } from './client.js';

/**
 * Parc machines (Phase 3) sur la stack réelle : sites, fiches techniques, machines,
 * configuration réseau chiffrée et tableau de bord, avec leur isolation par entreprise.
 *
 * Les données créées portent le préfixe « e2e- » : ce sont des données de test.
 */
const run = Date.now().toString(36);
const PASSWORD = `e2e-mot-de-passe-${run}`;
const COMMUNITY = `communaute-e2e-${run}`;

// Adresses distinctes de l'autre fichier : la limitation des connexions est par adresse IP.
const superAdmin = new Client('198.51.100.101');
const adminA = new Client('198.51.100.102');
const userA = new Client('198.51.100.103');
const adminB = new Client('198.51.100.104');

let tenantA: Tenant;
let tenantB: Tenant;
let siteA: Site;
let siteB: Site;
let catalogModel: PrinterModel;
let privateModelA: PrinterModel;
let printerA: PrinterDetail;

const api = (tenant: Tenant, path = '') => `/api/v1/tenants/${tenant.id}${path}`;

async function createTenant(label: string): Promise<Tenant> {
  const reply = await superAdmin.post<Tenant>('/api/v1/tenants', {
    name: `E2E Parc ${label} ${run}`,
    slug: `e2e-parc-${label.toLowerCase()}-${run}`,
  });
  expect(reply.status, JSON.stringify(reply.body)).toBe(201);
  return reply.body;
}

async function signInAs(client: Client, tenant: Tenant, role: string, label: string) {
  const reply = await superAdmin.post<UserAccount>(api(tenant, '/users'), {
    name: `E2E ${label}`,
    email: `e2e-parc-${label.toLowerCase()}-${run}@arksen.test`,
    role,
    password: PASSWORD,
  });
  expect(reply.status, JSON.stringify(reply.body)).toBe(201);
  expect((await client.signIn(reply.body.email, PASSWORD)).status).toBe(200);
}

async function created<T>(promise: Promise<{ status: number; body: T }>): Promise<T> {
  const reply = await promise;
  expect(reply.status, JSON.stringify(reply.body)).toBe(201);
  return reply.body;
}

beforeAll(async () => {
  expect(
    (await superAdmin.signIn(requireEnv('SUPER_ADMIN_EMAIL'), requireEnv('SUPER_ADMIN_PASSWORD')))
      .status,
  ).toBe(200);
  tenantA = await createTenant('A');
  tenantB = await createTenant('B');
  await signInAs(adminA, tenantA, 'CLIENT_ADMIN', 'AdminA');
  await signInAs(userA, tenantA, 'USER', 'UserA');
  await signInAs(adminB, tenantB, 'CLIENT_ADMIN', 'AdminB');

  catalogModel = await created(
    superAdmin.post<PrinterModel>('/api/v1/printer-models', {
      manufacturer: 'E2E Fabricant',
      name: `Catalogue ${run}`,
      colorMode: 'COLOR',
      speedMonoPpm: 30,
      speedColorPpm: 30,
    }),
  );
  siteA = await created(
    adminA.post<Site>(api(tenantA, '/sites'), { name: 'Siège', city: 'Dakar' }),
  );
  siteB = await created(adminB.post<Site>(api(tenantB, '/sites'), { name: 'Siège' }));
  privateModelA = await created(
    adminA.post<PrinterModel>(api(tenantA, '/printer-models'), {
      manufacturer: 'E2E Fabricant',
      name: `Privé A ${run}`,
      colorMode: 'MONOCHROME',
    }),
  );
  printerA = await created(
    adminA.post<PrinterDetail>(api(tenantA, '/printers'), {
      siteId: siteA.id,
      modelId: catalogModel.id,
      name: 'Accueil RDC',
      serialNumber: `E2E-${run}-A1`,
    }),
  );
});

// Le catalogue Arksen est partagé par toutes les entreprises : la fiche de test et les machines
// qui l'utilisent sont retirées, pour ne pas apparaître chez les autres entreprises.
afterAll(async () => {
  const systemDb = createPrismaClient(requireEnv('DATABASE_SYSTEM_URL'));
  try {
    await systemDb.printer.deleteMany({ where: { serialNumber: { startsWith: `E2E-${run}-` } } });
    await systemDb.printerModel.deleteMany({ where: { id: catalogModel?.id } });
  } finally {
    await systemDb.$disconnect();
  }
});

describe('parc machines', () => {
  it('rattache la machine à son site et à sa fiche technique', async () => {
    const reply = await adminA.get<PrinterDetail>(api(tenantA, `/printers/${printerA.id}`));

    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      status: 'ACTIVE',
      connectivity: 'UNKNOWN',
      site: { id: siteA.id },
      model: { id: catalogModel.id, colorMode: 'COLOR' },
      connection: null,
    });
  });

  it('refuse un numéro de série en double dans la même entreprise', async () => {
    const reply = await adminA.post(api(tenantA, '/printers'), {
      siteId: siteA.id,
      modelId: catalogModel.id,
      name: 'Doublon',
      serialNumber: printerA.serialNumber,
    });
    expect(reply.status).toBe(409);
  });

  it('refuse de supprimer un site qui porte des machines', async () => {
    const reply = await adminA.request('DELETE', api(tenantA, `/sites/${siteA.id}`));
    expect(reply.status).toBe(409);
  });

  it('trace le changement de statut dans le journal', async () => {
    const reply = await adminA.patch<PrinterDetail>(api(tenantA, `/printers/${printerA.id}`), {
      status: 'MAINTENANCE',
    });
    expect(reply.body.status).toBe('MAINTENANCE');

    const audit = await adminA.get<Page<{ action: string; targetId: string }>>(
      api(tenantA, '/audit-logs?search=printer.status_changed'),
    );
    expect(audit.body.items.some((entry) => entry.targetId === printerA.id)).toBe(true);
  });
});

describe('fiches techniques', () => {
  it('montre le catalogue Arksen à toutes les entreprises, mais les fiches privées à leur seule entreprise', async () => {
    const forB = await adminB.get<Page<PrinterModel>>(
      api(tenantB, `/printer-models?search=${run}`),
    );
    const ids = forB.body.items.map((model) => model.id);

    expect(ids).toContain(catalogModel.id);
    expect(ids).not.toContain(privateModelA.id);
  });

  it('interdit à une entreprise de modifier le catalogue Arksen', async () => {
    const viaTenant = await adminA.patch(api(tenantA, `/printer-models/${catalogModel.id}`), {
      name: 'Détourné',
    });
    const viaPlatform = await adminA.patch(`/api/v1/printer-models/${catalogModel.id}`, {
      name: 'Détourné',
    });

    expect(viaTenant.status).toBe(404);
    expect(viaPlatform.status).toBe(403);
  });

  it('refuse un doublon du catalogue parmi les fiches de l’entreprise', async () => {
    const reply = await adminA.post(api(tenantA, '/printer-models'), {
      manufacturer: catalogModel.manufacturer.toUpperCase(),
      name: catalogModel.name,
      colorMode: 'COLOR',
    });
    expect(reply.status).toBe(409);
  });
});

describe('isolation du parc (API)', () => {
  it('répond 404 sur les sites, machines et tableau de bord d’une autre entreprise', async () => {
    for (const path of ['/sites', `/printers/${printerA.id}`, '/fleet-dashboard']) {
      expect((await adminB.get(api(tenantA, path))).status, path).toBe(404);
    }
  });

  it('refuse d’utiliser le site ou la fiche privée d’une autre entreprise', async () => {
    const withSiteA = await adminB.post(api(tenantB, '/printers'), {
      siteId: siteA.id,
      modelId: catalogModel.id,
      name: 'Intrusion',
      serialNumber: `E2E-${run}-X1`,
    });
    const withModelA = await adminB.post(api(tenantB, '/printers'), {
      siteId: siteB.id,
      modelId: privateModelA.id,
      name: 'Intrusion',
      serialNumber: `E2E-${run}-X2`,
    });

    expect(withSiteA.status).toBe(400);
    expect(withModelA.status).toBe(400);
  });

  it('laisse un utilisateur consulter le parc sans pouvoir le modifier', async () => {
    expect((await userA.get(api(tenantA, '/printers'))).status).toBe(200);
    expect((await userA.get(api(tenantA, '/fleet-dashboard'))).status).toBe(200);
    expect(
      (
        await userA.post(api(tenantA, '/printers'), {
          siteId: siteA.id,
          modelId: catalogModel.id,
          name: 'Refusée',
          serialNumber: `E2E-${run}-U1`,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await userA.request('PUT', api(tenantA, `/printers/${printerA.id}/connection`), {
          ipAddress: '10.0.0.9',
          snmpVersion: 'V2C',
          snmpCommunity: 'x',
        })
      ).status,
    ).toBe(403);
  });
});

describe('configuration réseau', () => {
  it('chiffre la communauté SNMP et ne la renvoie jamais', async () => {
    const saved = await adminA.request<PrinterDetail>(
      'PUT',
      api(tenantA, `/printers/${printerA.id}/connection`),
      { ipAddress: '192.168.10.25', snmpVersion: 'V2C', snmpCommunity: COMMUNITY },
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.connection).toMatchObject({ ipAddress: '192.168.10.25', hasCommunity: true });

    const read = await adminA.get(api(tenantA, `/printers/${printerA.id}`));
    const list = await adminA.get(api(tenantA, '/printers'));
    const audit = await adminA.get(api(tenantA, '/audit-logs?search=printer.network'));
    for (const reply of [saved, read, list, audit]) {
      expect(JSON.stringify(reply.body)).not.toContain(COMMUNITY);
    }
  });

  it('conserve la communauté quand elle n’est pas renvoyée', async () => {
    const reply = await adminA.request<PrinterDetail>(
      'PUT',
      api(tenantA, `/printers/${printerA.id}/connection`),
      { ipAddress: '192.168.10.26', snmpVersion: 'V2C' },
    );
    expect(reply.body.connection).toMatchObject({ ipAddress: '192.168.10.26', hasCommunity: true });
  });
});

describe('tableau de bord', () => {
  it('compte les machines réelles et laisse la connectivité non mesurée', async () => {
    const reply = await adminA.get<FleetDashboard>(api(tenantA, '/fleet-dashboard'));

    expect(reply.status).toBe(200);
    expect(reply.body.totals).toMatchObject({
      printers: 1,
      sites: 1,
      color: 1,
      monochrome: 0,
      networkConfigured: 1,
    });
    expect(reply.body.byStatus.MAINTENANCE).toBe(1);
    expect(reply.body.byConnectivity).toEqual({ UNKNOWN: 1, ONLINE: 0, OFFLINE: 0 });
    expect(reply.body.bySite).toEqual([{ siteId: siteA.id, name: 'Siège', count: 1 }]);
    expect(reply.body.attention.map((printer) => printer.id)).toContain(printerA.id);
  });

  it('filtre par type couleur', async () => {
    const reply = await adminA.get<FleetDashboard>(
      api(tenantA, '/fleet-dashboard?colorMode=MONOCHROME'),
    );
    expect(reply.body.totals.printers).toBe(0);
  });
});

describe('isolation du parc (PostgreSQL)', () => {
  let appDb: PrismaClient;
  let systemDb: PrismaClient;

  beforeAll(() => {
    appDb = createPrismaClient(requireEnv('DATABASE_APP_URL'));
    systemDb = createPrismaClient(requireEnv('DATABASE_SYSTEM_URL'));
  });

  afterAll(async () => {
    await Promise.all([appDb.$disconnect(), systemDb.$disconnect()]);
  });

  it('stocke la communauté chiffrée', async () => {
    const [row] = await systemDb.$queryRaw<{ snmp_community: string }[]>`
      SELECT snmp_community FROM printer_connections WHERE printer_id = ${printerA.id}::uuid`;
    expect(row?.snmp_community).toMatch(/^v1\./);
    expect(row?.snmp_community).not.toContain(COMMUNITY);
  });

  it('ne montre à une entreprise que le catalogue et ses propres fiches', async () => {
    const visible = await withTenant(appDb, tenantB.id, (tx) =>
      tx.printerModel.findMany({ where: { name: { contains: run } }, select: { id: true } }),
    );
    const ids = visible.map((model) => model.id);
    expect(ids).toContain(catalogModel.id);
    expect(ids).not.toContain(privateModelA.id);
  });

  it('empêche le rôle métier de modifier le catalogue Arksen', async () => {
    const updated = await withTenant(appDb, tenantA.id, (tx) =>
      tx.printerModel.updateMany({ where: { id: catalogModel.id }, data: { name: 'Détourné' } }),
    );
    expect(updated.count).toBe(0);
  });

  it('refuse, même au rôle système, une machine rattachée au site d’une autre entreprise', async () => {
    await expect(systemDb.$executeRaw`
      INSERT INTO printers (id, tenant_id, site_id, model_id, name, serial_number, updated_at)
      VALUES (gen_random_uuid(), ${tenantB.id}::uuid, ${siteA.id}::uuid, ${catalogModel.id}::uuid,
              'Intrusion', ${`E2E-${run}-SQL1`}, now())`).rejects.toThrow();
  });

  it('refuse, même au rôle système, une machine utilisant la fiche privée d’une autre entreprise', async () => {
    await expect(systemDb.$executeRaw`
      INSERT INTO printers (id, tenant_id, site_id, model_id, name, serial_number, updated_at)
      VALUES (gen_random_uuid(), ${tenantB.id}::uuid, ${siteB.id}::uuid, ${privateModelA.id}::uuid,
              'Intrusion', ${`E2E-${run}-SQL2`}, now())`).rejects.toThrow(
      /Modèle d'imprimante introuvable/,
    );
  });
});
