import { createPrismaClient } from '@arksen/database';
import type {
  ConsumptionSimulation,
  FleetConsumption,
  PrinterConsumptionDetail,
  PrinterDetail,
  PrinterModel,
  Site,
  Tenant,
  TonerSpec,
  UserAccount,
} from '@arksen/shared-types';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, requireEnv } from './client.js';

/**
 * Moteur de consommation CMJN (Phase 5) de bout en bout : API, moteur Python et base.
 * Chaque valeur attendue est calculée à la main dans les commentaires.
 *
 * Toners fictifs : 300 g pour 15 000 pages à 5 %, soit 0,02 g par page de référence.
 * Prix : 90 la cartouche noire (0,30 par gramme), 60 les couleurs (0,20 par gramme).
 *
 * Les données créées portent le préfixe « e2e- » : ce sont des données de test.
 */
const run = Date.now().toString(36);
const PASSWORD = `e2e-mot-de-passe-${run}`;

const superAdmin = new Client('198.51.100.131');
const adminA = new Client('198.51.100.132');
const userA = new Client('198.51.100.133');
const adminB = new Client('198.51.100.134');

let tenantA: Tenant;
let tenantB: Tenant;
let colorModel: PrinterModel;
let monoModel: PrinterModel;
let printer: PrinterDetail;
let toners: TonerSpec[];

const api = (tenant: Tenant, path = '') => `/api/v1/tenants/${tenant.id}${path}`;

function daysAgo(days: number): Date {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const period = `from=${isoDay(daysAgo(25))}&to=${isoDay(daysAgo(0))}`;

async function created<T>(promise: Promise<{ status: number; body: T }>): Promise<T> {
  const reply = await promise;
  expect(reply.status, JSON.stringify(reply.body)).toBe(201);
  return reply.body;
}

async function ok<T>(promise: Promise<{ status: number; body: T }>, status = 200): Promise<T> {
  const reply = await promise;
  expect(reply.status, JSON.stringify(reply.body)).toBe(status);
  return reply.body;
}

async function signInAs(client: Client, tenant: Tenant, role: string, label: string) {
  const user = await created(
    superAdmin.post<UserAccount>(api(tenant, '/users'), {
      name: `E2E ${label}`,
      email: `e2e-conso-${label.toLowerCase()}-${run}@arksen.test`,
      role,
      password: PASSWORD,
    }),
  );
  expect((await client.signIn(user.email, PASSWORD)).status).toBe(200);
}

const toner = (reference: string) => ({ reference, capacityGrams: 300, yieldPages: 15000 });

beforeAll(async () => {
  expect(
    (await superAdmin.signIn(requireEnv('SUPER_ADMIN_EMAIL'), requireEnv('SUPER_ADMIN_PASSWORD')))
      .status,
  ).toBe(200);
  tenantA = await created(
    superAdmin.post<Tenant>('/api/v1/tenants', {
      name: `E2E Conso A ${run}`,
      slug: `e2e-conso-a-${run}`,
    }),
  );
  tenantB = await created(
    superAdmin.post<Tenant>('/api/v1/tenants', {
      name: `E2E Conso B ${run}`,
      slug: `e2e-conso-b-${run}`,
      currency: 'EUR',
    }),
  );
  await signInAs(adminA, tenantA, 'CLIENT_ADMIN', 'AdminA');
  await signInAs(userA, tenantA, 'USER', 'UserA');
  await signInAs(adminB, tenantB, 'CLIENT_ADMIN', 'AdminB');

  colorModel = await created(
    adminA.post<PrinterModel>(api(tenantA, '/printer-models'), {
      manufacturer: 'E2E Fabricant',
      name: `Couleur ${run}`,
      colorMode: 'COLOR',
    }),
  );
  monoModel = await created(
    adminA.post<PrinterModel>(api(tenantA, '/printer-models'), {
      manufacturer: 'E2E Fabricant',
      name: `Mono ${run}`,
      colorMode: 'MONOCHROME',
    }),
  );
  const site = await created(adminA.post<Site>(api(tenantA, '/sites'), { name: 'Atelier' }));
  printer = await created(
    adminA.post<PrinterDetail>(api(tenantA, '/printers'), {
      siteId: site.id,
      modelId: colorModel.id,
      name: 'Presse',
      serialNumber: `E2E-${run}-P`,
    }),
  );
  // 1 000 pages noir et blanc et 500 couleur entre les deux relevés : 1 500 pages au total.
  for (const [days, blackCount, colorCount] of [
    [20, 10000, 2000],
    [10, 11000, 2500],
  ] as const) {
    await created(
      adminA.post(api(tenantA, `/printers/${printer.id}/meter-readings`), {
        readAt: daysAgo(days).toISOString(),
        blackCount,
        colorCount,
      }),
    );
  }
});

describe('toners et prix', () => {
  it('renseigne un toner par canal et ses prix', async () => {
    for (const channel of ['CYAN', 'MAGENTA', 'YELLOW', 'BLACK']) {
      await ok(
        adminA.request(
          'PUT',
          api(tenantA, `/printer-models/${colorModel.id}/toners/${channel}`),
          toner(`TN-${channel}`),
        ),
      );
    }
    toners = await ok(
      adminA.get<TonerSpec[]>(api(tenantA, `/printer-models/${colorModel.id}/toners`)),
    );
    expect(toners.map((item) => item.channel)).toEqual(['CYAN', 'MAGENTA', 'YELLOW', 'BLACK']);
    expect(toners[0]).toMatchObject({ referenceCoverage: 5, unitPrice: null });

    for (const item of toners) {
      await ok(
        adminA.request('PUT', api(tenantA, `/toners/${item.id}/price`), {
          unitPrice: item.channel === 'BLACK' ? 90 : 60,
        }),
        204,
      );
    }
    const priced = await ok(
      adminA.get<TonerSpec[]>(api(tenantA, `/printer-models/${colorModel.id}/toners`)),
    );
    expect(priced.find((item) => item.channel === 'BLACK')!.unitPrice).toBe(90);
  });

  it('refuse un toner couleur sur un modèle noir et blanc', async () => {
    const reply = await adminA.request(
      'PUT',
      api(tenantA, `/printer-models/${monoModel.id}/toners/CYAN`),
      toner('TN-X'),
    );
    expect(reply.status).toBe(400);
  });

  it('réserve les toners d’une fiche privée à son entreprise', async () => {
    expect((await adminB.get(api(tenantB, `/printer-models/${colorModel.id}/toners`))).status).toBe(
      404,
    );
  });
});

describe('consommation d’une machine', () => {
  it('calcule chaque canal sur ses pages, avec l’aplat du profil', async () => {
    await ok(
      adminA.request('PUT', api(tenantA, `/printers/${printer.id}/calibration`), {
        coverage: { CYAN: 10, MAGENTA: 5, YELLOW: 2.5, BLACK: 5 },
        paperFormat: 'A4',
        mediaFactor: 1,
        manualCoefficients: { CYAN: null, MAGENTA: null, YELLOW: null, BLACK: null },
      }),
    );
    const detail = await ok(
      adminA.get<PrinterConsumptionDetail>(
        api(tenantA, `/printers/${printer.id}/consumption?${period}`),
      ),
    );
    const grams = Object.fromEntries(
      detail.channels.map((item) => [item.channel, item.theoreticalGrams]),
    );

    expect(detail.currency).toBe('XOF');
    expect(detail.pages).toMatchObject({ total: 1500, color: 500 });
    // Noir : 1 500 × 0,02 × 5/5 = 30 g. Cyan : 500 × 0,02 × 10/5 = 20 g.
    // Magenta : 500 × 0,02 = 10 g. Jaune : 500 × 0,02 × 2,5/5 = 5 g.
    expect(grams).toEqual({ CYAN: 20, MAGENTA: 10, YELLOW: 5, BLACK: 30 });
    // Coût : 30 × 0,30 + (20 + 10 + 5) × 0,20 = 9 + 7 = 16, soit 16 / 1 500 par page.
    expect(detail.totals).toMatchObject({
      theoreticalGrams: 65,
      costEstimated: 16,
      completeCost: true,
    });
    expect(detail.totals!.costPerPage).toBeCloseTo(16 / 1500, 6);
    expect(detail.channels.every((item) => item.calibration.source === 'default')).toBe(true);
  });

  it('compare une pesée au théorique et calibre la machine', async () => {
    await created(
      adminA.post(api(tenantA, `/printers/${printer.id}/consumption-measurements`), {
        channel: 'BLACK',
        from: isoDay(daysAgo(25)),
        to: isoDay(daysAgo(1)),
        method: 'WEIGHING',
        grams: 36,
      }),
    );
    const detail = await ok(
      adminA.get<PrinterConsumptionDetail>(
        api(tenantA, `/printers/${printer.id}/consumption?${period}`),
      ),
    );
    // Réel 36 g pour 30 g théoriques : +6 g, soit 20 % de surconsommation.
    expect(detail.measurements[0]).toMatchObject({
      method: 'WEIGHING',
      grams: 36,
      theoreticalGrams: 30,
      deviationGrams: 6,
      deviationRatio: 0.2,
      overconsumptionRatio: 0.2,
    });
    // Calibration lissée : (36 + 2 × 30) / (30 + 2 × 30) = 96 / 90 ; estimé : 30 × 96 / 90 = 32 g.
    const black = detail.channels.find((item) => item.channel === 'BLACK')!;
    expect(black.calibration).toMatchObject({
      source: 'printer',
      observations: 1,
      confidence: 'low',
    });
    expect(black.calibration.coefficient).toBeCloseTo(96 / 90, 4);
    expect(black.theoreticalGrams).toBe(30);
    expect(black.estimatedGrams).toBeCloseTo(32, 3);
  });

  it('convertit des cartouches vidées en grammes avec la masse du toner', async () => {
    const { id } = await created(
      adminA.post<{ id: string }>(
        api(tenantA, `/printers/${printer.id}/consumption-measurements`),
        {
          channel: 'CYAN',
          from: isoDay(daysAgo(25)),
          to: isoDay(daysAgo(1)),
          method: 'CARTRIDGES',
          cartridges: 0.5,
        },
      ),
    );
    const detail = await ok(
      adminA.get<PrinterConsumptionDetail>(
        api(tenantA, `/printers/${printer.id}/consumption?${period}`),
      ),
    );
    expect(detail.measurements.find((item) => item.id === id)).toMatchObject({
      grams: 150,
      cartridges: 0.5,
    });
    await ok(
      adminA.request(
        'DELETE',
        api(tenantA, `/printers/${printer.id}/consumption-measurements/${id}`),
      ),
      204,
    );
  });
});

describe('consommation du parc et simulation', () => {
  it('additionne le parc canal par canal', async () => {
    const fleet = await ok(adminA.get<FleetConsumption>(api(tenantA, `/consumption?${period}`)));
    const black = fleet.channels.find((item) => item.channel === 'BLACK')!;
    expect(fleet.totals.pages).toBe(1500);
    expect(black.theoreticalGrams).toBe(30);
    expect(black.estimatedGrams).toBeCloseTo(32, 3);
    expect(fleet.printers.map((item) => item.printerId)).toEqual([printer.id]);
  });

  it('simule un travail décrit par son aplat', async () => {
    const simulation = await ok(
      adminA.post<ConsumptionSimulation>(api(tenantA, '/consumption/simulate'), {
        modelId: colorModel.id,
        pages: 1000,
        colorPages: 400,
        coverage: { CYAN: 10, MAGENTA: 5, YELLOW: 5, BLACK: 5 },
        useCalibration: false,
      }),
    );
    // Noir 20 g (6), cyan 400 × 0,02 × 2 = 16 g (3,20), magenta et jaune 8 g (1,60 chacun).
    expect(simulation.totals).toMatchObject({ theoreticalGrams: 52, costEstimated: 12.4 });
    expect(simulation.totals.costPerPage).toBeCloseTo(0.0124, 6);
  });

  it('ne simule pas sans les toners de la fiche', async () => {
    const reply = await adminA.post(api(tenantA, '/consumption/simulate'), {
      modelId: monoModel.id,
      pages: 10,
      colorPages: 0,
      coverage: { CYAN: 0, MAGENTA: 0, YELLOW: 0, BLACK: 5 },
    });
    expect(reply.status).toBe(400);
  });
});

describe('droits et isolation', () => {
  it('réserve la consommation aux rôles qui la consultent', async () => {
    expect((await userA.get(api(tenantA, `/consumption?${period}`))).status).toBe(403);
  });

  it('répond 404 sur la consommation d’une autre entreprise', async () => {
    expect(
      (await adminB.get(api(tenantA, `/printers/${printer.id}/consumption?${period}`))).status,
    ).toBe(404);
  });

  it('refuse en base le prix d’un toner privé d’une autre entreprise, même au rôle système', async () => {
    const systemDb = createPrismaClient(requireEnv('DATABASE_SYSTEM_URL'));
    try {
      await expect(systemDb.$executeRaw`
        INSERT INTO toner_prices (tenant_id, toner_model_id, unit_price, updated_at)
        VALUES (${tenantB.id}::uuid, ${toners[0]!.id}::uuid, 1, now())`).rejects.toThrow(
        /Toner introuvable/,
      );
    } finally {
      await systemDb.$disconnect();
    }
  });
});
