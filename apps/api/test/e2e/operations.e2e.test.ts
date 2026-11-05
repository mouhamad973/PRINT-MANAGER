import { createPrismaClient } from '@arksen/database';
import type {
  Alert,
  Contract,
  CostReport,
  Intervention,
  Invoice,
  MaintenancePlan,
  Page,
  PaperStock,
  PaperType,
  PrintedJob,
  PrintJob,
  PrinterDetail,
  PrinterModel,
  Site,
  Tenant,
  TonerSpec,
  UserAccount,
} from '@arksen/shared-types';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, requireEnv, type Reply } from './client.js';
import { buildPdf, fill } from './pdf.js';

/**
 * Coûts, maintenance et contrats (Phase 9) de bout en bout, valeurs calculées à la main.
 *
 * Machine couleur, toners de 300 g pour 15 000 pages à 5 % (0,02 g par page), noir à 90,
 * couleurs à 60. Relevés : 10 000 / 2 000 il y a 31 jours, 20 000 / 4 000 hier. Sur la
 * période (40 jours), 12 000 pages dont 2 000 couleur :
 * - toner noir : 0,02 × 12 000 = 240 g, soit 240 / 300 × 90 = 72 ;
 * - chaque couleur : 0,02 × 2 000 = 40 g, soit 8 ; cyan, magenta, jaune : 24 ;
 * - papier : rame de 500 feuilles à 2 500, soit 5 la feuille ; 50 % de recto verso :
 *   12 000 × 0,75 = 9 000 feuilles, soit 45 000 ;
 * - intervention : 3 000 de main-d'œuvre et 2 000 de pièces.
 */
const run = Date.now().toString(36);
const PASSWORD = `e2e-mot-de-passe-${run}`;
const DAY = 24 * 60 * 60 * 1000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
const PERIOD = { from: isoDay(daysAgo(40)), to: isoDay(new Date()) };

const superAdmin = new Client('198.51.100.171');
const adminA = new Client('198.51.100.172');
const technician = new Client('198.51.100.173');
const userA = new Client('198.51.100.174');
const adminB = new Client('198.51.100.175');

let tenantA: Tenant;
let tenantB: Tenant;
let site: Site;
let printer: PrinterDetail;
let other: PrinterDetail;
let paper: PaperType;

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
      email: `e2e-ops-${label.toLowerCase()}-${run}@arksen.test`,
      role,
      password: PASSWORD,
    }),
  );
  expect((await client.signIn(user.email, PASSWORD)).status).toBe(200);
  return user;
}

async function activeAlerts(): Promise<Alert[]> {
  return (await ok(adminA.get<Page<Alert>>(api(tenantA, '/alerts?pageSize=100')))).items;
}

let technicianUser: UserAccount;

beforeAll(async () => {
  expect(
    (await superAdmin.signIn(requireEnv('SUPER_ADMIN_EMAIL'), requireEnv('SUPER_ADMIN_PASSWORD')))
      .status,
  ).toBe(200);
  tenantA = await created(
    superAdmin.post<Tenant>('/api/v1/tenants', {
      name: `E2E Ops A ${run}`,
      slug: `e2e-ops-a-${run}`,
    }),
  );
  tenantB = await created(
    superAdmin.post<Tenant>('/api/v1/tenants', {
      name: `E2E Ops B ${run}`,
      slug: `e2e-ops-b-${run}`,
    }),
  );
  await signInAs(adminA, tenantA, 'CLIENT_ADMIN', 'AdminA');
  technicianUser = await signInAs(technician, tenantA, 'TECHNICIAN', 'Tech');
  await signInAs(userA, tenantA, 'USER', 'UserA');
  await signInAs(adminB, tenantB, 'CLIENT_ADMIN', 'AdminB');

  const model = await created(
    adminA.post<PrinterModel>(api(tenantA, '/printer-models'), {
      manufacturer: 'E2E Fabricant',
      name: `Ops ${run}`,
      colorMode: 'COLOR',
    }),
  );
  for (const channel of ['CYAN', 'MAGENTA', 'YELLOW', 'BLACK']) {
    const toner = await ok(
      adminA.request<TonerSpec>(
        'PUT',
        api(tenantA, `/printer-models/${model.id}/toners/${channel}`),
        {
          reference: `E2E-${channel}-${run}`,
          capacityGrams: 300,
          yieldPages: 15000,
        },
      ),
    );
    await ok(
      adminA.request('PUT', api(tenantA, `/toners/${toner.id}/price`), {
        unitPrice: channel === 'BLACK' ? 90 : 60,
      }),
      204,
    );
  }
  site = await created(adminA.post<Site>(api(tenantA, '/sites'), { name: 'Atelier' }));
  printer = await created(
    adminA.post<PrinterDetail>(api(tenantA, '/printers'), {
      siteId: site.id,
      modelId: model.id,
      name: 'Presse',
      serialNumber: `E2E-${run}-OPS`,
    }),
  );
  other = await created(
    adminA.post<PrinterDetail>(api(tenantA, '/printers'), {
      siteId: site.id,
      modelId: model.id,
      name: 'Seconde',
      serialNumber: `E2E-${run}-OPS2`,
    }),
  );
  for (const [days, black, color] of [
    [31, 10000, 2000],
    [1, 20000, 4000],
  ] as const) {
    await created(
      adminA.post(api(tenantA, `/printers/${printer.id}/meter-readings`), {
        readAt: daysAgo(days).toISOString(),
        blackCount: black,
        colorCount: color,
      }),
    );
  }
});

describe('interventions', () => {
  let ticket: Intervention;

  it('laisse un utilisateur signaler une panne, sans la planifier', async () => {
    ticket = await created(
      userA.post<Intervention>(api(tenantA, '/interventions'), {
        printerId: printer.id,
        title: 'Bourrage au bac 2',
        priority: 'HIGH',
      }),
    );
    expect(ticket).toMatchObject({
      number: 1,
      status: 'OPEN',
      type: 'CORRECTIVE',
      priority: 'HIGH',
    });
    const scheduled = await userA.post(api(tenantA, '/interventions'), {
      printerId: printer.id,
      title: 'Révision',
      scheduledAt: new Date(Date.now() + DAY).toISOString(),
    });
    expect(scheduled.status).toBe(403);
    expect(
      (await userA.patch(api(tenantA, `/interventions/${ticket.id}`), { status: 'DONE' })).status,
    ).toBe(403);
  });

  it('se conduit jusqu’à la clôture, compteur et coûts compris', async () => {
    const assignees = await ok(
      technician.get<{ id: string }[]>(api(tenantA, '/interventions/assignees')),
    );
    expect(assignees.map((user) => user.id)).toContain(technicianUser.id);
    const started = await ok(
      technician.patch<Intervention>(api(tenantA, `/interventions/${ticket.id}`), {
        status: 'IN_PROGRESS',
        assigneeId: technicianUser.id,
      }),
    );
    expect(started).toMatchObject({ status: 'IN_PROGRESS', assignee: { id: technicianUser.id } });
    expect(started.startedAt).not.toBeNull();

    const noReport = await technician.patch(api(tenantA, `/interventions/${ticket.id}`), {
      status: 'DONE',
    });
    expect(noReport.status).toBe(400);
    const done = await ok(
      technician.patch<Intervention>(api(tenantA, `/interventions/${ticket.id}`), {
        status: 'DONE',
        resolution: 'Rouleaux du bac 2 remplacés',
        laborMinutes: 45,
        laborCost: 3000,
        partsCost: 2000,
      }),
    );
    // Compteur total au dernier relevé : 20 000 + 4 000.
    expect(done).toMatchObject({ status: 'DONE', counter: 24000, totalCost: 5000 });
    const closed = await technician.patch(api(tenantA, `/interventions/${ticket.id}`), {
      priority: 'LOW',
    });
    expect(closed.status).toBe(400);
  });
});

describe('coûts d’impression et coût copie', () => {
  it('chiffre toner, papier, interventions et coût copie de chaque machine', async () => {
    paper = await created(
      adminA.post<PaperType>(api(tenantA, '/paper-types'), {
        name: `A4 80 g ${run}`,
        format: 'A4',
        grammage: 80,
        reamPrice: 2500,
      }),
    );
    expect(paper).toMatchObject({ sheetsPerReam: 500, sheetPrice: 5 });
    await ok(
      adminA.request('PUT', api(tenantA, `/printers/${printer.id}/cost-settings`), {
        paperTypeId: paper.id,
        duplexPercent: 50,
        monthlyFixedCost: '',
      }),
    );
    const report = await ok(
      adminA.get<CostReport>(api(tenantA, `/costs?from=${PERIOD.from}&to=${PERIOD.to}`)),
    );
    const cost = report.printers.find((item) => item.printer.id === printer.id)!;
    expect(cost).toMatchObject({
      pages: 12000,
      colorPages: 2000,
      toner: 96,
      paper: 45000,
      maintenance: 5000,
      fixed: 0,
      total: 50096,
      gaps: [],
    });
    // Page noire : (72 + 45 000 + 5 000) / 12 000 ; couleur : + 24 / 2 000.
    expect(cost.costPerBlackPage).toBeCloseTo(50072 / 12000, 5);
    expect(cost.costPerColorPage).toBeCloseTo(50072 / 12000 + 24 / 2000, 5);
    const idle = report.printers.find((item) => item.printer.id === other.id)!;
    expect(idle.gaps).toContain('NO_PAGES');
    expect(report.totals.total).toBe(50096);
  });

  it('réserve les réglages de coût aux gestionnaires', async () => {
    const denied = await technician.request(
      'PUT',
      api(tenantA, `/printers/${printer.id}/cost-settings`),
      {
        duplexPercent: 0,
      },
    );
    expect(denied.status).toBe(403);
    expect(
      (await technician.get(api(tenantA, `/costs?from=${PERIOD.from}&to=${PERIOD.to}`))).status,
    ).toBe(403);
  });
});

describe('contrats et relevés de facturation', () => {
  let contract: Contract;
  let invoice: Invoice;

  it('couvre des machines, une seule fois chacune', async () => {
    contract = await created(
      adminA.post<Contract>(api(tenantA, '/contracts'), {
        reference: `CTR-${run}`,
        customerName: 'Client E2E',
        startDate: isoDay(daysAgo(60)),
        fixedFee: 10000,
        includedBlackPages: 5000,
        includedColorPages: 1000,
        blackPagePrice: 5,
        colorPagePrice: 30,
      }),
    );
    contract = await ok(
      adminA.request<Contract>('PUT', api(tenantA, `/contracts/${contract.id}/printers`), {
        printerIds: [printer.id],
      }),
    );
    expect(contract.printers.map((item) => item.id)).toEqual([printer.id]);
    const second = await created(
      adminA.post<Contract>(api(tenantA, '/contracts'), {
        reference: `CTR2-${run}`,
        customerName: 'Autre client',
        startDate: isoDay(daysAgo(60)),
        blackPagePrice: 5,
        colorPagePrice: 30,
      }),
    );
    const taken = await adminA.request('PUT', api(tenantA, `/contracts/${second.id}/printers`), {
      printerIds: [printer.id],
    });
    expect(taken.status).toBe(409);
  });

  it('établit le relevé : forfait, pages au-delà des pages incluses, marge', async () => {
    invoice = await created(
      adminA.post<Invoice>(api(tenantA, `/contracts/${contract.id}/invoices`), {
        periodStart: PERIOD.from,
        periodEnd: PERIOD.to,
      }),
    );
    // 10 000 N&B dont 5 000 en plus à 5 ; 2 000 couleur dont 1 000 en plus à 30.
    expect(invoice).toMatchObject({
      status: 'DRAFT',
      number: null,
      blackPages: 10000,
      colorPages: 2000,
      extraBlackPages: 5000,
      extraColorPages: 1000,
      extraBlackAmount: 25000,
      extraColorAmount: 30000,
      totalAmount: 65000,
      cost: 50096,
      margin: 14904,
    });
    expect(invoice.lines).toEqual([
      expect.objectContaining({ printerId: printer.id, blackPages: 10000 }),
    ]);
  });

  it('numérote à l’émission, puis fige le relevé', async () => {
    const issued = await ok(
      adminA.post<Invoice>(api(tenantA, `/invoices/${invoice.id}/issue`), {}),
    );
    const year = new Date().getFullYear();
    expect(issued).toMatchObject({ status: 'ISSUED', number: `REL-${year}-0001` });
    const next = await created(
      adminA.post<Invoice>(api(tenantA, `/contracts/${contract.id}/invoices`), {
        periodStart: PERIOD.from,
        periodEnd: PERIOD.to,
      }),
    );
    expect(
      (await ok(adminA.post<Invoice>(api(tenantA, `/invoices/${next.id}/issue`), {}))).number,
    ).toBe(`REL-${year}-0002`);

    const systemDb = createPrismaClient(requireEnv('DATABASE_SYSTEM_URL'));
    try {
      await expect(
        systemDb.$executeRaw`UPDATE invoices SET total_amount = 1 WHERE id = ${invoice.id}::uuid`,
      ).rejects.toThrow(/ne se modifie pas/);
      await expect(
        systemDb.$executeRaw`DELETE FROM invoices WHERE id = ${invoice.id}::uuid`,
      ).rejects.toThrow(/ne se supprime pas/);
    } finally {
      await systemDb.$disconnect();
    }
    await ok(adminA.request('DELETE', api(tenantA, `/invoices/${invoice.id}`)), 204);
    const list = await ok(
      adminA.get<Page<Invoice>>(api(tenantA, `/invoices?contractId=${contract.id}`)),
    );
    expect(list.items.find((item) => item.id === invoice.id)).toMatchObject({
      status: 'CANCELLED',
      number: `REL-${year}-0001`,
    });
  });
});

describe('maintenance préventive', () => {
  let plan: MaintenancePlan;

  it('suit l’échéance en pages et l’annonce', async () => {
    plan = await created(
      technician.post<MaintenancePlan>(api(tenantA, '/maintenance-plans'), {
        printerId: printer.id,
        name: 'Révision',
        intervalPages: 14000,
      }),
    );
    expect(plan).toMatchObject({ state: 'OK', counter: 24000, pagesSince: 0 });
    // 13 000 pages de plus : 93 % de l'intervalle.
    await created(
      adminA.post(api(tenantA, `/printers/${printer.id}/meter-readings`), {
        readAt: new Date(Date.now() - 60_000).toISOString(),
        blackCount: 31000,
        colorCount: 6000,
      }),
    );
    plan = await ok(
      technician.patch<MaintenancePlan>(api(tenantA, `/maintenance-plans/${plan.id}`), {
        notes: 'Rouleaux et four',
      }),
    );
    expect(plan).toMatchObject({ state: 'DUE_SOON', pagesSince: 13000 });
    expect((await activeAlerts()).map((alert) => alert.type)).toContain('MAINTENANCE_DUE');
  });

  it('repart à zéro quand la maintenance est faite', async () => {
    const preventive = await created(
      technician.post<Intervention>(api(tenantA, '/interventions'), {
        printerId: printer.id,
        title: 'Révision préventive',
        planId: plan.id,
      }),
    );
    expect(preventive.type).toBe('PREVENTIVE');
    await ok(
      technician.patch(api(tenantA, `/interventions/${preventive.id}`), {
        status: 'DONE',
        resolution: 'Révision faite',
      }),
    );
    const [current] = await ok(
      technician.get<MaintenancePlan[]>(api(tenantA, `/maintenance-plans?printerId=${printer.id}`)),
    );
    expect(current).toMatchObject({ state: 'OK', pagesSince: 0, counter: 37000 });
    expect((await activeAlerts()).map((alert) => alert.type)).not.toContain('MAINTENANCE_DUE');
  });
});

describe('papier', () => {
  it('tient le stock en rames et signale le seuil', async () => {
    let stock = await created(
      adminA.post<PaperStock>(api(tenantA, '/paper-stocks'), {
        siteId: site.id,
        paperTypeId: paper.id,
        minQuantity: 5,
      }),
    );
    expect(stock).toMatchObject({ quantity: 0, level: 'OUT' });
    stock = await created(
      adminA.post<PaperStock>(api(tenantA, `/paper-stocks/${stock.id}/movements`), {
        type: 'RECEIPT',
        quantity: 20,
        unitCost: 2500,
      }),
    );
    expect(stock).toMatchObject({ quantity: 20, level: 'OK', value: 50000 });
    // La machine réglée sur ce papier consomme ses pages : une prévision existe.
    expect(stock.forecast.reamsPerDay).not.toBeNull();
    stock = await created(
      adminA.post<PaperStock>(api(tenantA, `/paper-stocks/${stock.id}/movements`), {
        type: 'ISSUE',
        quantity: 16,
      }),
    );
    expect(stock.level).toBe('LOW');
    expect((await activeAlerts()).map((alert) => alert.type)).toContain('PAPER_LOW');
    const short = await adminA.post<{ message: string }>(
      api(tenantA, `/paper-stocks/${stock.id}/movements`),
      {
        type: 'ISSUE',
        quantity: 10,
      },
    );
    expect(short.status).toBe(400);
    expect(short.body.message).toBe('Stock insuffisant : 4 rame(s) disponible(s).');
  });
});

describe('impressions', () => {
  it('enregistre un travail imprimé avec son coût de revient et sa marge', async () => {
    const job = await created(
      adminA.upload<PrintJob>(api(tenantA, '/print-jobs'), {
        name: 'affiche.pdf',
        data: buildPdf([fill('0 0 0')]),
        type: 'application/pdf',
      }),
    );
    const printed = await created(
      adminA.post<PrintedJob>(api(tenantA, `/print-jobs/${job.id}/printed`), {
        printerId: printer.id,
        copies: 10,
        salePrice: 1000,
      }),
    );
    // Toner : 10 pages noires à 100 % : 0,02 × 20 × 10 = 4 g, soit 1,20 (sans calibration mesurée).
    // Papier : 10 pages A4 à 50 % de recto verso : 7,5 feuilles à 5, soit 37,50.
    expect(printed.tonerCost).toBeCloseTo(1.2, 1);
    expect(printed.paperCost).toBe(37.5);
    expect(printed.margin).toBeCloseTo(1000 - 38.7, 1);
    const register = await ok(adminA.get<Page<PrintedJob>>(api(tenantA, '/print-jobs/printed')));
    expect(register.items[0]).toMatchObject({ id: job.id, copies: 10, salePrice: 1000 });
  });
});

describe('isolation', () => {
  it('cache coûts, contrats, interventions et papier d’une autre entreprise', async () => {
    expect((await adminB.get(api(tenantA, '/contracts'))).status).toBe(404);
    const own = await ok(
      adminB.get<Page<Intervention>>(api(tenantB, '/interventions?status=DONE')),
    );
    expect(own.total).toBe(0);
    const foreign = await adminB.post(api(tenantB, '/interventions'), {
      printerId: printer.id,
      title: 'Machine d’une autre entreprise',
    });
    expect(foreign.status).toBe(400);

    const appDb = createPrismaClient(requireEnv('DATABASE_APP_URL'));
    try {
      const visible = await appDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantB.id}, true)`;
        return tx.$queryRaw<{ n: bigint }[]>`
          SELECT (SELECT count(*) FROM contracts) + (SELECT count(*) FROM invoices)
               + (SELECT count(*) FROM interventions) + (SELECT count(*) FROM maintenance_plans)
               + (SELECT count(*) FROM paper_types) + (SELECT count(*) FROM paper_stocks)
               + (SELECT count(*) FROM printer_cost_settings) AS n`;
      });
      expect(Number(visible[0]!.n)).toBe(0);
    } finally {
      await appDb.$disconnect();
    }
  });
});
