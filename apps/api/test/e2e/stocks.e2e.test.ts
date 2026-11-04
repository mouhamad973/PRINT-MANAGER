import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@arksen/database';
import type {
  Alert,
  AgentEnrollment,
  AgentEnrollmentCode,
  AlertSummary,
  DetectedReplacement,
  Page,
  PrinterDetail,
  PrinterModel,
  PrinterSnmpState,
  Site,
  StockMovement,
  Tenant,
  TonerReference,
  TonerReplacement,
  TonerSpec,
  TonerStock,
  UserAccount,
} from '@arksen/shared-types';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, requireEnv, WEB_URL, type Reply } from './client.js';

/**
 * Toners, stocks et alertes (Phase 8) de bout en bout : registre des mouvements, seuils,
 * transferts, remplacements et rendement réel, alertes de stock et de niveau SNMP (envoyées
 * par un agent de collecte), prévision de rupture par le moteur CMJN, droits et isolation.
 *
 * Toner noir fictif : 300 g pour 15 000 pages à 5 %, soit 0,02 g par page.
 */
const run = Date.now().toString(36);
const PASSWORD = `e2e-mot-de-passe-${run}`;
const BLACK = `E2E-K-${run}`;
const CYAN = `E2E-C-${run}`;
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const superAdmin = new Client('198.51.100.161');
const adminA = new Client('198.51.100.162');
const stockManager = new Client('198.51.100.163');
const technician = new Client('198.51.100.164');
const userA = new Client('198.51.100.165');
const adminB = new Client('198.51.100.166');

let tenantA: Tenant;
let tenantB: Tenant;
let headOffice: Site;
let branch: Site;
let printer: PrinterDetail;
let stock: TonerStock;
let agentId: string;
let agentToken: string;

const api = (tenant: Tenant, path = '') => `/api/v1/tenants/${tenant.id}${path}`;

async function created<T>(promise: Promise<Reply<T>>): Promise<T> {
  const reply = await promise;
  expect(reply.status, JSON.stringify(reply.body)).toBe(201);
  return reply.body;
}

async function ok<T>(promise: Promise<Reply<T>>, status = 200): Promise<T> {
  const reply = await promise;
  expect(reply.status, JSON.stringify(reply.body)).toBe(status);
  return reply.body;
}

async function signInAs(client: Client, tenant: Tenant, role: string, label: string) {
  const user = await created(
    superAdmin.post<UserAccount>(api(tenant, '/users'), {
      name: `E2E ${label}`,
      email: `e2e-stock-${label.toLowerCase()}-${run}@arksen.test`,
      role,
      password: PASSWORD,
    }),
  );
  expect((await client.signIn(user.email, PASSWORD)).status).toBe(200);
}

async function stockOf(id: string): Promise<TonerStock> {
  return ok(adminA.get<TonerStock>(api(tenantA, `/stocks/${id}`)));
}

async function activeAlerts(): Promise<Alert[]> {
  return (await ok(adminA.get<Page<Alert>>(api(tenantA, '/alerts?pageSize=100')))).items;
}

/** État SNMP envoyé par l'agent de collecte, comme après une vraie collecte. */
async function levels(supplies: { channel: string; levelPercent: number }[], minutesAgo = 0) {
  const response = await fetch(`${WEB_URL}/backend/api/v1/agent/v1/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      events: [
        {
          id: randomUUID(),
          type: 'printer.status',
          schemaVersion: 1,
          agentId,
          printerId: printer.id,
          occurredAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
          payload: {
            reachable: true,
            alerts: [],
            supplies: supplies.map((supply, index) => ({
              index: index + 1,
              description: `Toner ${supply.channel}`,
              kind: 'tonerCartridge',
              ...supply,
            })),
          },
        },
      ],
    }),
  });
  const body = (await response.json()) as { acks: { status: string; error?: string }[] };
  expect(body.acks[0], JSON.stringify(body)).toMatchObject({ status: 'accepted' });
}

beforeAll(async () => {
  expect(
    (await superAdmin.signIn(requireEnv('SUPER_ADMIN_EMAIL'), requireEnv('SUPER_ADMIN_PASSWORD')))
      .status,
  ).toBe(200);
  tenantA = await created(
    superAdmin.post<Tenant>('/api/v1/tenants', {
      name: `E2E Stock A ${run}`,
      slug: `e2e-stock-a-${run}`,
    }),
  );
  tenantB = await created(
    superAdmin.post<Tenant>('/api/v1/tenants', {
      name: `E2E Stock B ${run}`,
      slug: `e2e-stock-b-${run}`,
    }),
  );
  await signInAs(adminA, tenantA, 'CLIENT_ADMIN', 'AdminA');
  await signInAs(stockManager, tenantA, 'STOCK_MANAGER', 'Stock');
  await signInAs(technician, tenantA, 'TECHNICIAN', 'Tech');
  await signInAs(userA, tenantA, 'USER', 'UserA');
  await signInAs(adminB, tenantB, 'CLIENT_ADMIN', 'AdminB');

  const model = await created(
    adminA.post<PrinterModel>(api(tenantA, '/printer-models'), {
      manufacturer: 'E2E Fabricant',
      name: `Stock ${run}`,
      colorMode: 'COLOR',
    }),
  );
  for (const [channel, reference] of [
    ['BLACK', BLACK],
    ['CYAN', CYAN],
    // Le moteur n'estime un modèle couleur que si ses quatre toners sont renseignés.
    ['MAGENTA', `E2E-M-${run}`],
    ['YELLOW', `E2E-Y-${run}`],
  ] as const) {
    const toner = await ok(
      adminA.request<TonerSpec>(
        'PUT',
        api(tenantA, `/printer-models/${model.id}/toners/${channel}`),
        {
          reference,
          capacityGrams: 300,
          yieldPages: 15000,
        },
      ),
    );
    await ok(
      adminA.request('PUT', api(tenantA, `/toners/${toner.id}/price`), { unitPrice: 90 }),
      204,
    );
  }
  headOffice = await created(adminA.post<Site>(api(tenantA, '/sites'), { name: 'Siège' }));
  branch = await created(adminA.post<Site>(api(tenantA, '/sites'), { name: 'Agence' }));
  printer = await created(
    adminA.post<PrinterDetail>(api(tenantA, '/printers'), {
      siteId: headOffice.id,
      modelId: model.id,
      name: 'Couleur',
      serialNumber: `E2E-${run}-STOCK`,
    }),
  );

  const enrollment = await created(
    adminA.post<AgentEnrollmentCode>(api(tenantA, '/agents'), { name: 'Agent stock', siteId: '' }),
  );
  const enrolled = await fetch(`${WEB_URL}/backend/api/v1/agent/v1/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: enrollment.enrollmentCode, hostname: 'E2E', version: '0.1.0' }),
  });
  const agent = (await enrolled.json()) as AgentEnrollment;
  agentId = agent.agentId;
  agentToken = agent.token;
});

describe('articles et registre des mouvements', () => {
  it('suit une référence des fiches techniques sur un site', async () => {
    stock = await created(
      stockManager.post<TonerStock>(api(tenantA, '/stocks'), {
        siteId: headOffice.id,
        reference: BLACK.toLowerCase(),
        minQuantity: 2,
        leadTimeDays: 10,
      }),
    );
    expect(stock).toMatchObject({
      reference: BLACK,
      channel: 'BLACK',
      quantity: 0,
      level: 'OUT',
      printers: 1,
      currency: 'XOF',
    });
    // Seuil de 2 et aucune cartouche : rupture signalée aussitôt.
    expect((await activeAlerts()).map((alert) => alert.type)).toEqual(['STOCK_OUT']);

    const unknown = await stockManager.post(api(tenantA, '/stocks'), {
      siteId: headOffice.id,
      reference: 'INCONNUE',
    });
    expect(unknown.status).toBe(400);
    const duplicate = await stockManager.post(api(tenantA, '/stocks'), {
      siteId: headOffice.id,
      reference: BLACK,
    });
    expect(duplicate.status).toBe(409);
  });

  it('tient le solde par le registre, sans jamais passer sous zéro', async () => {
    let current = await ok(
      stockManager.post<TonerStock>(api(tenantA, `/stocks/${stock.id}/movements`), {
        type: 'RECEIPT',
        quantity: 5,
        unitCost: 80,
        reference: 'BL-001',
      }),
      201,
    );
    expect(current).toMatchObject({ quantity: 5, level: 'OK', unitCost: 80, value: 400 });
    expect(await activeAlerts()).toEqual([]);

    current = await ok(
      stockManager.post<TonerStock>(api(tenantA, `/stocks/${stock.id}/movements`), {
        type: 'ISSUE',
        quantity: 4,
      }),
      201,
    );
    expect(current).toMatchObject({ quantity: 1, level: 'LOW' });
    expect((await activeAlerts()).map((alert) => alert.type)).toEqual(['STOCK_LOW']);

    const tooMany = await stockManager.post<{ message: string }>(
      api(tenantA, `/stocks/${stock.id}/movements`),
      { type: 'ISSUE', quantity: 3 },
    );
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toBe('Stock insuffisant : 1 cartouche(s) disponible(s).');

    // Inventaire : 3 comptées pour 1 enregistrée, l'écart devient un mouvement de +2.
    current = await ok(
      stockManager.post<TonerStock>(api(tenantA, `/stocks/${stock.id}/movements`), {
        type: 'ADJUSTMENT',
        countedQuantity: 3,
      }),
      201,
    );
    expect(current.quantity).toBe(3);
    const movements = await ok(
      stockManager.get<Page<StockMovement>>(api(tenantA, `/stocks/${stock.id}/movements`)),
    );
    expect(movements.items.map((item) => [item.type, item.quantity, item.balanceAfter])).toEqual([
      ['ADJUSTMENT', 2, 3],
      ['ISSUE', -4, 1],
      ['RECEIPT', 5, 5],
    ]);
  });

  it('transfère entre sites par deux mouvements liés', async () => {
    const { from, to } = await ok(
      stockManager.post<{ from: TonerStock; to: TonerStock }>(api(tenantA, '/stocks/transfers'), {
        fromStockId: stock.id,
        toSiteId: branch.id,
        quantity: 1,
      }),
      201,
    );
    expect(from).toMatchObject({ quantity: 2, level: 'LOW' });
    expect(to).toMatchObject({ reference: BLACK, quantity: 1, site: { id: branch.id } });
  });

  it('garde le registre immuable en base', async () => {
    const systemDb = createPrismaClient(requireEnv('DATABASE_SYSTEM_URL'));
    try {
      await expect(
        systemDb.$executeRaw`UPDATE stock_movements SET quantity = 100 WHERE stock_id = ${stock.id}::uuid`,
      ).rejects.toThrow(/ne se modifie pas/);
      await expect(
        systemDb.$executeRaw`DELETE FROM stock_movements WHERE stock_id = ${stock.id}::uuid`,
      ).rejects.toThrow(/ne se modifie pas/);
      await expect(
        systemDb.$executeRaw`UPDATE toner_stocks SET quantity = 100 WHERE id = ${stock.id}::uuid`,
      ).rejects.toThrow(/ne change que par un mouvement/);
    } finally {
      await systemDb.$disconnect();
    }
  });
});

describe('remplacements et rendement réel', () => {
  let second: TonerReplacement;

  it('mesure le rendement de la cartouche retirée et la sort du stock', async () => {
    for (const [days, black] of [
      [10, 10000],
      [2, 22500],
    ] as const) {
      await created(
        adminA.post(api(tenantA, `/printers/${printer.id}/meter-readings`), {
          readAt: daysAgo(days),
          blackCount: black,
          colorCount: 2000,
        }),
      );
    }
    const first = await created(
      technician.post<TonerReplacement>(api(tenantA, '/toner-replacements'), {
        printerId: printer.id,
        channel: 'BLACK',
        replacedAt: daysAgo(9),
        stockId: stock.id,
      }),
    );
    expect(first).toMatchObject({ counter: 10000, pagesSincePrevious: null, reference: BLACK });
    second = await created(
      technician.post<TonerReplacement>(api(tenantA, '/toner-replacements'), {
        printerId: printer.id,
        channel: 'BLACK',
        replacedAt: daysAgo(1),
        stockId: stock.id,
      }),
    );
    expect(second).toMatchObject({ counter: 22500, pagesSincePrevious: 12500, yieldPages: 15000 });
    expect(await stockOf(stock.id)).toMatchObject({ quantity: 0, level: 'OUT' });

    const empty = await technician.post<{ message: string }>(api(tenantA, '/toner-replacements'), {
      printerId: printer.id,
      channel: 'BLACK',
      replacedAt: daysAgo(0),
      stockId: stock.id,
    });
    expect(empty.status).toBe(400);
    expect(empty.body.message).toMatch(/Stock insuffisant/);

    const wrongReference = await technician.post(api(tenantA, '/toner-replacements'), {
      printerId: printer.id,
      channel: 'CYAN',
      replacedAt: daysAgo(0),
      stockId: stock.id,
    });
    expect(wrongReference.status).toBe(400);

    const references = await ok(
      stockManager.get<TonerReference[]>(api(tenantA, '/toner-references')),
    );
    expect(references.find((item) => item.reference === BLACK)).toMatchObject({
      averageYield: 12500,
      yieldSamples: 1,
      replacements90d: 2,
      stock: 1,
      printers: 1,
    });
  });

  it('annule un remplacement : la cartouche revient dans son stock', async () => {
    await ok(technician.request('DELETE', api(tenantA, `/toner-replacements/${second.id}`)), 204);
    expect(await stockOf(stock.id)).toMatchObject({ quantity: 1, level: 'LOW' });
    const history = await ok(
      adminA.get<Page<TonerReplacement>>(
        api(tenantA, `/toner-replacements?printerId=${printer.id}`),
      ),
    );
    expect(history.total).toBe(1);
    const movements = await ok(
      adminA.get<Page<StockMovement>>(api(tenantA, `/stocks/${stock.id}/movements`)),
    );
    expect(movements.items[0]).toMatchObject({
      type: 'CANCELLATION',
      quantity: 1,
      balanceAfter: 1,
    });
  });
});

describe('alertes', () => {
  it('suit le niveau SNMP des cartouches : bas, épuisé, puis résolu au remplacement', async () => {
    await levels([{ channel: 'BLACK', levelPercent: 8 }], 30);
    expect((await activeAlerts()).some((alert) => alert.type === 'TONER_LOW')).toBe(true);
    await levels([{ channel: 'BLACK', levelPercent: 1 }], 20);
    let alerts = await activeAlerts();
    expect(alerts.filter((alert) => alert.channel === 'BLACK').map((alert) => alert.type)).toEqual([
      'TONER_EMPTY',
    ]);
    // Rafraîchie, l'alerte reste unique.
    await levels([{ channel: 'BLACK', levelPercent: 1 }], 15);
    alerts = await activeAlerts();
    expect(alerts.filter((alert) => alert.type === 'TONER_EMPTY')).toHaveLength(1);

    await levels([{ channel: 'BLACK', levelPercent: 100 }], 10);
    alerts = await activeAlerts();
    expect(alerts.filter((alert) => alert.printer?.id === printer.id)).toEqual([]);
    const resolved = await ok(
      adminA.get<Page<Alert>>(api(tenantA, '/alerts?status=RESOLVED&type=TONER_EMPTY')),
    );
    expect(resolved.items[0]).toMatchObject({ resolution: 'auto' });
  });

  it('propose les remontées de niveau sans remplacement enregistré', async () => {
    await levels([{ channel: 'CYAN', levelPercent: 15 }], 5);
    await levels([{ channel: 'CYAN', levelPercent: 98 }], 1);
    const detected = await ok(
      adminA.get<DetectedReplacement[]>(api(tenantA, '/toner-replacements/detected')),
    );
    // Le noir est remonté de 1 à 100 % sans remplacement proche (celui d'hier a été annulé).
    expect(detected).toEqual([
      expect.objectContaining({ channel: 'CYAN', levelBefore: 15, levelAfter: 98 }),
      expect.objectContaining({ channel: 'BLACK', levelBefore: 1, levelAfter: 100 }),
    ]);
    const { state } = await ok(
      adminA.get<{ state: PrinterSnmpState }>(api(tenantA, `/printers/${printer.id}/snmp-state`)),
    );
    expect(state.forecasts.map((item) => item.channel)).toEqual(['CYAN', 'BLACK']);
  });

  it('prévoit la rupture avec le moteur CMJN', async () => {
    await ok(
      stockManager.request('PATCH', api(tenantA, `/stocks/${stock.id}`), { leadTimeDays: 365 }),
    );
    const evaluated = await ok(
      stockManager.post<{ raised: number }>(api(tenantA, '/stocks/evaluate-alerts'), {}),
    );
    expect(evaluated.raised).toBe(1);
    // 12 500 pages noires × 0,02 g = 250 g sur 90 jours, soit 250 / 300 / 90 cartouche par jour.
    const current = await stockOf(stock.id);
    expect(current.forecast.method).toBe('engine');
    expect(current.forecast.cartridgesPerDay).toBeCloseTo(250 / 300 / 90, 4);
    expect(current.forecast.daysOfCover).toBeCloseTo(108, 0);
    expect((await activeAlerts()).map((alert) => alert.type).sort()).toEqual([
      'STOCK_FORECAST',
      'STOCK_LOW',
    ]);
  });

  it('prend en compte puis clôture une alerte, et résume les stocks critiques', async () => {
    const low = (await activeAlerts()).find((alert) => alert.type === 'STOCK_LOW')!;
    const acknowledged = await ok(
      stockManager.patch<Alert>(api(tenantA, `/alerts/${low.id}`), { action: 'acknowledge' }),
    );
    expect(acknowledged).toMatchObject({ status: 'ACKNOWLEDGED' });
    const closed = await ok(
      stockManager.patch<Alert>(api(tenantA, `/alerts/${low.id}`), { action: 'resolve' }),
    );
    expect(closed).toMatchObject({ status: 'RESOLVED', resolution: 'manual' });

    expect((await userA.get(api(tenantA, '/alerts/summary'))).status).toBe(403);
    const own = await ok(adminA.get<AlertSummary>(api(tenantA, '/alerts/summary')));
    expect(own.criticalStocks).toEqual([
      expect.objectContaining({ id: stock.id, level: 'LOW', siteName: 'Siège' }),
    ]);
  });
});

describe('droits et isolation', () => {
  it('réserve les stocks aux rôles autorisés', async () => {
    expect((await userA.get(api(tenantA, '/stocks'))).status).toBe(403);
    expect((await technician.get(api(tenantA, '/stocks'))).status).toBe(200);
    const denied = await technician.post(api(tenantA, `/stocks/${stock.id}/movements`), {
      type: 'RECEIPT',
      quantity: 1,
    });
    expect(denied.status).toBe(403);
  });

  it('cache les stocks et les alertes d’une autre entreprise', async () => {
    expect((await adminB.get(api(tenantA, '/stocks'))).status).toBe(404);
    expect((await adminB.get(api(tenantB, `/stocks/${stock.id}`))).status).toBe(404);
    const own = await ok(adminB.get<Page<TonerStock>>(api(tenantB, '/stocks')));
    expect(own.total).toBe(0);
    const transfer = await adminB.post(api(tenantB, '/stocks/transfers'), {
      fromStockId: stock.id,
      toSiteId: branch.id,
      quantity: 1,
    });
    expect(transfer.status).toBe(404);

    const appDb = createPrismaClient(requireEnv('DATABASE_APP_URL'));
    try {
      const visible = await appDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantB.id}, true)`;
        return tx.$queryRaw<{ n: bigint }[]>`
          SELECT (SELECT count(*) FROM toner_stocks) + (SELECT count(*) FROM stock_movements)
               + (SELECT count(*) FROM toner_replacements) + (SELECT count(*) FROM alerts)
               + (SELECT count(*) FROM supply_level_readings) AS n`;
      });
      expect(Number(visible[0]!.n)).toBe(0);
    } finally {
      await appDb.$disconnect();
    }
  });
});
