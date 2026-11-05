import { createPrismaClient } from '@arksen/database';
import {
  REPORT_FORMATS,
  REPORT_TYPES,
  type PrinterDetail,
  type PrinterModel,
  type RetentionRun,
  type RetentionStatus,
  type Site,
  type Statistics,
  type Tenant,
  type TonerSpec,
  type UserAccount,
} from '@arksen/shared-types';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, requireEnv, type Reply } from './client.js';

/** Rapports, statistiques, export du journal d'audit et conservation des données (Phase 10). */
const run = Date.now().toString(36);
const PASSWORD = `e2e-mot-de-passe-${run}`;
const DAY = 24 * 60 * 60 * 1000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
const PERIOD = `from=${isoDay(daysAgo(40))}&to=${isoDay(new Date())}`;

const superAdmin = new Client('198.51.100.181');
const adminA = new Client('198.51.100.182');
const userA = new Client('198.51.100.183');
const adminB = new Client('198.51.100.184');

let tenantA: Tenant;
let tenantB: Tenant;
let printer: PrinterDetail;

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
      email: `e2e-reports-${label.toLowerCase()}-${run}@arksen.test`,
      role,
      password: PASSWORD,
    }),
  );
  expect((await client.signIn(user.email, PASSWORD)).status).toBe(200);
}

const SIGNATURES: Record<string, (data: Buffer) => boolean> = {
  pdf: (data) => data.subarray(0, 5).toString('latin1') === '%PDF-',
  xlsx: (data) => data.subarray(0, 2).toString('latin1') === 'PK',
  csv: (data) => data.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
};

beforeAll(async () => {
  expect(
    (await superAdmin.signIn(requireEnv('SUPER_ADMIN_EMAIL'), requireEnv('SUPER_ADMIN_PASSWORD')))
      .status,
  ).toBe(200);
  tenantA = await created(
    superAdmin.post<Tenant>('/api/v1/tenants', {
      name: `E2E Rapports A ${run}`,
      slug: `e2e-rapports-a-${run}`,
    }),
  );
  tenantB = await created(
    superAdmin.post<Tenant>('/api/v1/tenants', {
      name: `E2E Rapports B ${run}`,
      slug: `e2e-rapports-b-${run}`,
    }),
  );
  await signInAs(adminA, tenantA, 'CLIENT_ADMIN', 'AdminA');
  await signInAs(userA, tenantA, 'USER', 'UserA');
  await signInAs(adminB, tenantB, 'CLIENT_ADMIN', 'AdminB');

  const model = await created(
    adminA.post<PrinterModel>(api(tenantA, '/printer-models'), {
      manufacturer: 'E2E Fabricant',
      name: `Rapports ${run}`,
      colorMode: 'COLOR',
    }),
  );
  for (const channel of ['CYAN', 'MAGENTA', 'YELLOW', 'BLACK']) {
    const toner = await ok(
      adminA.request<TonerSpec>(
        'PUT',
        api(tenantA, `/printer-models/${model.id}/toners/${channel}`),
        { reference: `E2E-R-${channel}-${run}`, capacityGrams: 300, yieldPages: 15000 },
      ),
    );
    await ok(
      adminA.request('PUT', api(tenantA, `/toners/${toner.id}/price`), {
        unitPrice: channel === 'BLACK' ? 90 : 60,
      }),
      204,
    );
  }
  const site = await created(adminA.post<Site>(api(tenantA, '/sites'), { name: 'Siège' }));
  printer = await created(
    adminA.post<PrinterDetail>(api(tenantA, '/printers'), {
      siteId: site.id,
      modelId: model.id,
      name: 'Presse Rapports',
      serialNumber: `E2E-${run}-RPT`,
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

describe('rapports', () => {
  it('produit chaque rapport dans chacun des trois formats', async () => {
    for (const type of REPORT_TYPES) {
      for (const format of REPORT_FORMATS) {
        const reply = await adminA.download(
          api(tenantA, `/reports/${type}?format=${format}&${PERIOD}`),
        );
        expect(reply.status, `${type}.${format} : ${reply.data.toString('utf8', 0, 200)}`).toBe(
          200,
        );
        expect(SIGNATURES[format]!(reply.data), `${type}.${format}`).toBe(true);
        expect(reply.headers.get('content-disposition')).toMatch(
          new RegExp(`attachment; filename="arksen-.+\\.${format}"`),
        );
        expect(reply.headers.get('cache-control')).toBe('no-store');
      }
    }
  });

  it('écrit les volumes réels dans le rapport de production', async () => {
    const reply = await adminA.download(api(tenantA, `/reports/production?format=csv&${PERIOD}`));
    const text = reply.data.toString('utf8');
    expect(text).toContain('Presse Rapports');
    // 10 000 pages noir et 2 000 couleur entre les deux relevés.
    expect(text).toMatch(/12000/);
  });

  it('applique les droits de chaque rapport', async () => {
    expect((await userA.download(api(tenantA, `/reports/production?${PERIOD}`))).status).toBe(200);
    for (const type of ['costs', 'stocks', 'profitability', 'consumption-cmyk']) {
      expect((await userA.download(api(tenantA, `/reports/${type}?${PERIOD}`))).status, type).toBe(
        403,
      );
    }
    // Une autre entreprise n'est pas révélée : 404, comme partout ailleurs.
    expect((await adminB.download(api(tenantA, `/reports/production?${PERIOD}`))).status).toBe(404);
  });

  it('refuse un rapport inconnu, une période inversée ou future', async () => {
    expect((await adminA.download(api(tenantA, '/reports/inconnu'))).status).toBe(404);
    expect(
      (await adminA.download(api(tenantA, '/reports/production?from=2026-06-01&to=2026-05-01')))
        .status,
    ).toBe(400);
    const future = isoDay(new Date(Date.now() + 5 * DAY));
    expect(
      (
        await adminA.download(
          api(tenantA, `/reports/production?from=${isoDay(new Date())}&to=${future}`),
        )
      ).status,
    ).toBe(400);
    expect((await adminA.download(api(tenantA, '/reports/production?format=docx'))).status).toBe(
      400,
    );
  });

  it('inscrit chaque export au journal d’audit', async () => {
    const reply = await adminA.download(
      api(tenantA, `/audit-logs/export?from=${isoDay(daysAgo(1))}&to=${isoDay(new Date())}`),
    );
    expect(reply.status).toBe(200);
    expect(reply.headers.get('content-type')).toMatch(/text\/csv/);
    const text = reply.data.toString('utf8');
    expect(text).toContain('report.exported');
    expect(text).not.toContain(tenantB.name);
  });
});

describe('statistiques', () => {
  it('donne les tendances mois par mois', async () => {
    const stats = await ok(adminA.get<Statistics>(api(tenantA, '/statistics')));
    expect(stats.months).toHaveLength(6);
    expect(stats.currency).toBeTruthy();
    expect(stats.months.reduce((sum, month) => sum + month.pages, 0)).toBeGreaterThan(0);
    expect(stats.topPrinters[0]?.name).toBe('Presse Rapports');
    const short = await ok(adminA.get<Statistics>(api(tenantA, '/statistics?months=3')));
    expect(short.months).toHaveLength(3);
  });

  it('réserve les statistiques aux rôles qui voient les coûts', async () => {
    expect((await userA.get(api(tenantA, '/statistics'))).status).toBe(403);
    expect((await adminA.get(api(tenantA, '/statistics?months=24'))).status).toBe(400);
  });
});

describe('journal d’audit', () => {
  it('exporte le journal d’une entreprise à ses seuls administrateurs', async () => {
    const query = `from=${isoDay(daysAgo(1))}&to=${isoDay(new Date())}`;
    expect((await userA.download(api(tenantA, `/audit-logs/export?${query}`))).status).toBe(403);
    expect((await adminB.download(api(tenantA, `/audit-logs/export?${query}`))).status).toBe(404);
    expect((await adminA.download(api(tenantA, '/audit-logs/export'))).status).toBe(400);
  });

  it('exporte le journal de la plateforme au Super Administrateur', async () => {
    const query = `from=${isoDay(daysAgo(1))}&to=${isoDay(new Date())}`;
    const reply = await superAdmin.download(`/api/v1/audit-logs/export?${query}`);
    expect(reply.status).toBe(200);
    const text = reply.data.toString('utf8');
    expect(text.split('\n')[0]).toContain('Date (UTC);Entreprise;Utilisateur;Action');
    expect(text).toContain(tenantA.name);
    expect(text).toContain(tenantB.name);
    expect((await adminA.download(`/api/v1/audit-logs/export?${query}`)).status).toBe(403);
  });

  it('protège le journal en base : ni modification, ni purge de moins d’un an', async () => {
    const systemDb = createPrismaClient(requireEnv('DATABASE_SYSTEM_URL'));
    try {
      await expect(
        systemDb.$executeRaw`UPDATE audit_logs SET action = 'falsifié' WHERE tenant_id = ${tenantA.id}::uuid`,
      ).rejects.toThrow(/ajout seul/);
      await expect(
        systemDb.$executeRaw`DELETE FROM audit_logs WHERE tenant_id = ${tenantA.id}::uuid`,
      ).rejects.toThrow(/ajout seul/);
      // Même en activant le drapeau de purge, une entrée récente ne peut pas être supprimée.
      await expect(
        systemDb.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('arksen.audit_purge', 'on', true)`;
          await tx.$executeRaw`DELETE FROM audit_logs WHERE tenant_id = ${tenantA.id}::uuid`;
        }),
      ).rejects.toThrow(/ajout seul/);
      await expect(
        systemDb.$queryRaw`SELECT purge_audit_logs(now() - interval '30 days')`,
      ).rejects.toThrow(/un an au moins/);
    } finally {
      await systemDb.$disconnect();
    }
  });

  it('réserve la purge du journal au rôle système', async () => {
    const appDb = createPrismaClient(requireEnv('DATABASE_APP_URL'));
    try {
      await expect(
        appDb.$queryRaw`SELECT purge_audit_logs(now() - interval '400 days')`,
      ).rejects.toThrow(/permission denied|droit refusé/i);
    } finally {
      await appDb.$disconnect();
    }
  });
});

describe('conservation des données', () => {
  it('présente la politique au Super Administrateur seulement', async () => {
    const status = await ok(superAdmin.get<RetentionStatus>('/api/v1/system/retention'));
    expect(status.policy.auditLogs).toBeGreaterThanOrEqual(365);
    expect(Object.keys(status.policy).sort()).toEqual(
      ['agentEvents', 'agentSyncLogs', 'auditLogs', 'resolvedAlerts', 'supplyLevels'].sort(),
    );
    expect((await adminA.get('/api/v1/system/retention')).status).toBe(403);
    expect((await adminA.post('/api/v1/system/retention/run', {})).status).toBe(403);
  });

  it('applique la politique à la demande, sans toucher aux données récentes', async () => {
    const before = await ok(adminA.get<{ total: number }>(api(tenantA, '/audit-logs')));
    const result = await ok(superAdmin.post<RetentionRun>('/api/v1/system/retention/run', {}));
    expect(result.trigger).toBe('manual');
    for (const count of Object.values(result.purged)) {
      expect(count).toBeGreaterThanOrEqual(0);
    }
    const after = await ok(adminA.get<{ total: number }>(api(tenantA, '/audit-logs')));
    expect(after.total).toBeGreaterThanOrEqual(before.total);
    const status = await ok(superAdmin.get<RetentionStatus>('/api/v1/system/retention'));
    expect(status.lastRun?.startedAt).toBe(result.startedAt);
    const logs = await ok(
      superAdmin.get<{ items: { action: string }[] }>(
        '/api/v1/audit-logs?search=system.retention_applied',
      ),
    );
    expect(logs.items.length).toBeGreaterThan(0);
  });
});
