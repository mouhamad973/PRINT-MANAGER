import { createPrismaClient, type PrismaClient } from '@arksen/database';
import type {
  FleetMeterAnomaly,
  FleetVolumes,
  MeterImportResult,
  MeterReading,
  Page,
  PrinterDetail,
  PrinterModel,
  PrinterVolumes,
  Site,
  Tenant,
  UserAccount,
} from '@arksen/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, requireEnv } from './client.js';

/**
 * Compteurs (Phase 4) sur la stack réelle : relevés, import idempotent, volumes, comparaison
 * de périodes et anomalies, avec leur isolation par entreprise.
 *
 * Les données créées portent le préfixe « e2e- » : ce sont des données de test.
 */
const run = Date.now().toString(36);
const PASSWORD = `e2e-mot-de-passe-${run}`;

const superAdmin = new Client('198.51.100.121');
const technicianA = new Client('198.51.100.122');
const userA = new Client('198.51.100.123');
const adminB = new Client('198.51.100.124');

let tenantA: Tenant;
let tenantB: Tenant;
let colorPrinter: PrinterDetail;
let monoPrinter: PrinterDetail;

const api = (tenant: Tenant, path = '') => `/api/v1/tenants/${tenant.id}${path}`;

/** Date UTC décalée de `days` jours par rapport à aujourd'hui, à midi. */
function daysAgo(days: number): Date {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

async function created<T>(promise: Promise<{ status: number; body: T }>): Promise<T> {
  const reply = await promise;
  expect(reply.status, JSON.stringify(reply.body)).toBe(201);
  return reply.body;
}

async function createTenant(label: string): Promise<Tenant> {
  return created(
    superAdmin.post<Tenant>('/api/v1/tenants', {
      name: `E2E Compteurs ${label} ${run}`,
      slug: `e2e-compteurs-${label.toLowerCase()}-${run}`,
    }),
  );
}

async function signInAs(client: Client, tenant: Tenant, role: string, label: string) {
  const user = await created(
    superAdmin.post<UserAccount>(api(tenant, '/users'), {
      name: `E2E ${label}`,
      email: `e2e-compteurs-${label.toLowerCase()}-${run}@arksen.test`,
      role,
      password: PASSWORD,
    }),
  );
  expect((await client.signIn(user.email, PASSWORD)).status).toBe(200);
}

async function printer(colorMode: 'COLOR' | 'MONOCHROME', serial: string): Promise<PrinterDetail> {
  const site = await created(
    superAdmin.post<Site>(api(tenantA, '/sites'), { name: `Site ${serial}` }),
  );
  const model = await created(
    superAdmin.post<PrinterModel>(api(tenantA, '/printer-models'), {
      manufacturer: 'E2E Fabricant',
      name: `Modèle ${serial}`,
      colorMode,
      monthlyDutyCycle: 30000,
    }),
  );
  return created(
    superAdmin.post<PrinterDetail>(api(tenantA, '/printers'), {
      siteId: site.id,
      modelId: model.id,
      name: `Machine ${serial}`,
      serialNumber: serial,
    }),
  );
}

function reading(target: PrinterDetail, readAt: Date, blackCount: number, colorCount?: number) {
  return technicianA.post<MeterReading>(api(tenantA, `/printers/${target.id}/meter-readings`), {
    readAt: readAt.toISOString(),
    blackCount,
    ...(colorCount === undefined ? {} : { colorCount }),
  });
}

beforeAll(async () => {
  expect(
    (await superAdmin.signIn(requireEnv('SUPER_ADMIN_EMAIL'), requireEnv('SUPER_ADMIN_PASSWORD')))
      .status,
  ).toBe(200);
  tenantA = await createTenant('A');
  tenantB = await createTenant('B');
  await signInAs(technicianA, tenantA, 'TECHNICIAN', 'TechA');
  await signInAs(userA, tenantA, 'USER', 'UserA');
  await signInAs(adminB, tenantB, 'CLIENT_ADMIN', 'AdminB');
  colorPrinter = await printer('COLOR', `E2E-${run}-C`);
  monoPrinter = await printer('MONOCHROME', `E2E-${run}-M`);
});

describe('relevés', () => {
  it('enregistre des relevés et calcule le volume de chacun', async () => {
    await created(reading(colorPrinter, daysAgo(20), 10000, 2000));
    await created(reading(colorPrinter, daysAgo(10), 11000, 2500));

    const history = await userA.get<Page<MeterReading>>(
      api(tenantA, `/printers/${colorPrinter.id}/meter-readings`),
    );
    expect(history.status).toBe(200);
    expect(history.body.items[0]).toMatchObject({
      totalCount: 13500,
      source: 'MANUAL',
      delta: { black: 1000, color: 500, total: 1500 },
      anomalies: [],
    });
    expect(history.body.items[1]!.delta).toBeNull();
  });

  it('exige le compteur couleur d’une machine couleur et le refuse en noir et blanc', async () => {
    expect((await reading(colorPrinter, daysAgo(9), 11100)).status).toBe(400);
    expect((await reading(monoPrinter, daysAgo(9), 500, 10)).status).toBe(400);
  });

  it('refuse un relevé daté dans le futur ou en double', async () => {
    expect((await reading(colorPrinter, daysAgo(-2), 20000, 3000)).status).toBe(400);
    expect((await reading(colorPrinter, daysAgo(10), 11000, 2500)).status).toBe(409);
  });

  it('signale un compteur en baisse sur le relevé en cause', async () => {
    const lower = await created(reading(colorPrinter, daysAgo(5), 10500, 2500));
    const history = await technicianA.get<Page<MeterReading>>(
      api(tenantA, `/printers/${colorPrinter.id}/meter-readings`),
    );
    const item = history.body.items.find((entry) => entry.id === lower.id)!;
    expect(item.delta).toBeNull();
    expect(item.anomalies.map((anomaly) => anomaly.code)).toEqual(['COUNTER_DECREASE']);

    const removed = await technicianA.request(
      'DELETE',
      api(tenantA, `/printers/${colorPrinter.id}/meter-readings/${lower.id}`),
    );
    expect(removed.status).toBe(204);
  });

  it('réserve la saisie aux rôles qui gèrent les compteurs', async () => {
    const reply = await userA.post(api(tenantA, `/printers/${monoPrinter.id}/meter-readings`), {
      readAt: daysAgo(1).toISOString(),
      blackCount: 1,
    });
    expect(reply.status).toBe(403);
  });
});

describe('import', () => {
  const rows = () => [
    {
      serialNumber: monoPrinter.serialNumber.toLowerCase(),
      readAt: daysAgo(30).toISOString(),
      blackCount: 5000,
    },
    { serialNumber: monoPrinter.serialNumber, readAt: daysAgo(1).toISOString(), blackCount: 8000 },
    { serialNumber: 'INCONNU', readAt: daysAgo(1).toISOString(), blackCount: 1 },
  ];

  it('importe les lignes valides et explique les autres', async () => {
    const reply = await technicianA.post<MeterImportResult>(
      api(tenantA, '/meter-readings/import'),
      {
        rows: rows(),
      },
    );
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ created: 2, duplicates: 0 });
    expect(reply.body.errors).toEqual([
      { row: 3, message: 'Aucune machine ne porte le numéro de série INCONNU.' },
    ]);
  });

  it('peut être rejoué sans créer de doublon', async () => {
    const reply = await technicianA.post<MeterImportResult>(
      api(tenantA, '/meter-readings/import'),
      {
        rows: rows(),
      },
    );
    expect(reply.body).toMatchObject({ created: 0, duplicates: 2 });
  });

  it('ne retrouve jamais une machine d’une autre entreprise par son numéro de série', async () => {
    const reply = await adminB.post<MeterImportResult>(api(tenantB, '/meter-readings/import'), {
      rows: [
        {
          serialNumber: monoPrinter.serialNumber,
          readAt: daysAgo(2).toISOString(),
          blackCount: 9000,
        },
      ],
    });
    expect(reply.body.created).toBe(0);
    expect(reply.body.errors).toHaveLength(1);
  });
});

describe('volumes', () => {
  it('répartit les pages entre deux relevés, jour par jour', async () => {
    const from = isoDay(daysAgo(19));
    const to = isoDay(daysAgo(10));
    const reply = await userA.get<PrinterVolumes>(
      api(tenantA, `/printers/${colorPrinter.id}/volumes?from=${from}&to=${to}`),
    );

    expect(reply.status).toBe(200);
    expect(reply.body.granularity).toBe('day');
    expect(reply.body.series).toHaveLength(10);
    // 1 500 pages sur 10 jours, mesurées de midi à midi : 9,5 jours de la période sont couverts.
    expect(reply.body.totals.total).toBe(1425);
    expect(reply.body.totals.coverage).toBe(0.95);
  });

  it('additionne le parc et le compare à la période précédente', async () => {
    const reply = await userA.get<FleetVolumes>(
      api(tenantA, `/volumes?from=${isoDay(daysAgo(29))}&to=${isoDay(daysAgo(0))}`),
    );

    expect(reply.status).toBe(200);
    expect(reply.body.comparison.kind).toBe('previous');
    expect(reply.body.totals.total).toBeGreaterThan(reply.body.previousTotals.total);
    const mono = reply.body.byPrinter.find((entry) => entry.printerId === monoPrinter.id)!;
    expect(mono.current.color).toBe(0);
    expect(mono.current.black).toBeGreaterThan(2800);
    expect(mono.lastReadingAt).not.toBeNull();
  });

  it('refuse une période inversée', async () => {
    const reply = await userA.get(api(tenantA, `/volumes?from=2026-10-31&to=2026-10-01`));
    expect(reply.status).toBe(400);
  });
});

describe('anomalies', () => {
  it('signale le volume au-delà du maximum constructeur', async () => {
    // 11 500 pages en une dizaine de jours, pour 1 000 pages par jour au maximum (30 000 par mois).
    await created(reading(colorPrinter, new Date(Date.now() - 3_600_000), 21000, 4000));
    const reply = await userA.get<FleetMeterAnomaly[]>(
      api(tenantA, `/meter-anomalies?printerId=${colorPrinter.id}`),
    );

    expect(reply.status).toBe(200);
    expect(reply.body.map((anomaly) => anomaly.code)).toContain('ABOVE_DUTY_CYCLE');
    expect(reply.body.every((anomaly) => anomaly.printerId === colorPrinter.id)).toBe(true);
  });
});

describe('isolation des compteurs', () => {
  let appDb: PrismaClient;

  beforeAll(() => {
    appDb = createPrismaClient(requireEnv('DATABASE_APP_URL'));
  });

  afterAll(async () => {
    await appDb.$disconnect();
  });

  it('répond 404 sur les relevés, volumes et anomalies d’une autre entreprise', async () => {
    for (const path of [
      `/printers/${colorPrinter.id}/meter-readings`,
      `/volumes?from=${isoDay(daysAgo(29))}&to=${isoDay(daysAgo(0))}`,
      '/meter-anomalies',
    ]) {
      expect((await adminB.get(api(tenantA, path))).status, path).toBe(404);
    }
  });

  it('refuse en base un relevé incohérent, même au rôle système', async () => {
    const systemDb = createPrismaClient(requireEnv('DATABASE_SYSTEM_URL'));
    try {
      await expect(systemDb.$executeRaw`
        INSERT INTO meter_readings (id, tenant_id, printer_id, read_at, black_count, color_count, total_count)
        VALUES (gen_random_uuid(), ${tenantA.id}::uuid, ${monoPrinter.id}::uuid, now(), 10, 5, 99)`).rejects.toThrow(
        /meter_readings_total_consistent/,
      );
    } finally {
      await systemDb.$disconnect();
    }
  });

  it('ne montre aucun relevé sans contexte d’entreprise', async () => {
    expect(await appDb.meterReading.count()).toBe(0);
  });
});
