import { createPrismaClient } from '@arksen/database';
import type {
  Page,
  PrintJob,
  PrintJobEstimate,
  PrintJobSummary,
  PrinterDetail,
  PrinterModel,
  Site,
  Tenant,
  TonerSpec,
  UserAccount,
} from '@arksen/shared-types';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, requireEnv } from './client.js';
import { A3, buildPdf, fill } from './pdf.js';

/**
 * Analyse PDF (Phase 6) de bout en bout : envoi par le relais du frontend, API, service d'analyse
 * Python, moteur CMJN et base. Chaque valeur attendue est calculée à la main.
 *
 * Document de test, trois pages :
 * 1. A4, moitié basse en cyan pur : cyan 50 %.
 * 2. A4 entièrement noire : noir 100 %.
 * 3. A3 blanche : rien, pour une surface de deux A4.
 * Surface totale : 4 A4. Moyenne pondérée : cyan 50 / 4 = 12,5 % ; noir 100 / 4 = 25 %.
 *
 * Toners fictifs : 300 g pour 15 000 pages (0,02 g par page à 5 %), 90 le noir, 60 les couleurs.
 *
 * Les données créées portent le préfixe « e2e- » : ce sont des données de test.
 */
const run = Date.now().toString(36);
const PASSWORD = `e2e-mot-de-passe-${run}`;
const PDF = buildPdf([fill('0 1 1', 0.5), fill('0 0 0'), { size: A3 }]);
// L'anticrénelage du bord de l'aplat cyan déplace la mesure de quelques centièmes.
const PRECISION = 1;

const superAdmin = new Client('198.51.100.141');
const adminA = new Client('198.51.100.142');
const userA = new Client('198.51.100.143');
const adminB = new Client('198.51.100.144');

let tenantA: Tenant;
let tenantB: Tenant;
let colorPrinter: PrinterDetail;
let monoPrinter: PrinterDetail;
let printerB: PrinterDetail;
let job: PrintJob;

const api = (tenant: Tenant, path = '') => `/api/v1/tenants/${tenant.id}${path}`;

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
      email: `e2e-pdf-${label.toLowerCase()}-${run}@arksen.test`,
      role,
      password: PASSWORD,
    }),
  );
  expect((await client.signIn(user.email, PASSWORD)).status).toBe(200);
}

/** Machine avec ses toners et leurs prix. */
async function printerWith(
  client: Client,
  tenant: Tenant,
  colorMode: 'COLOR' | 'MONOCHROME',
  label: string,
): Promise<PrinterDetail> {
  const model = await created(
    client.post<PrinterModel>(api(tenant, '/printer-models'), {
      manufacturer: 'E2E Fabricant',
      name: `${label} ${run}`,
      colorMode,
    }),
  );
  const channels = colorMode === 'COLOR' ? ['CYAN', 'MAGENTA', 'YELLOW', 'BLACK'] : ['BLACK'];
  for (const channel of channels) {
    const toner = await ok(
      client.request<TonerSpec>(
        'PUT',
        api(tenant, `/printer-models/${model.id}/toners/${channel}`),
        {
          reference: `TN-${channel}`,
          capacityGrams: 300,
          yieldPages: 15000,
        },
      ),
    );
    await ok(
      client.request('PUT', api(tenant, `/toners/${toner.id}/price`), {
        unitPrice: channel === 'BLACK' ? 90 : 60,
      }),
      204,
    );
  }
  const site = await created(client.post<Site>(api(tenant, '/sites'), { name: `Site ${label}` }));
  return created(
    client.post<PrinterDetail>(api(tenant, '/printers'), {
      siteId: site.id,
      modelId: model.id,
      name: label,
      serialNumber: `E2E-${run}-${label}`,
    }),
  );
}

beforeAll(async () => {
  expect(
    (await superAdmin.signIn(requireEnv('SUPER_ADMIN_EMAIL'), requireEnv('SUPER_ADMIN_PASSWORD')))
      .status,
  ).toBe(200);
  tenantA = await created(
    superAdmin.post<Tenant>('/api/v1/tenants', {
      name: `E2E PDF A ${run}`,
      slug: `e2e-pdf-a-${run}`,
    }),
  );
  tenantB = await created(
    superAdmin.post<Tenant>('/api/v1/tenants', {
      name: `E2E PDF B ${run}`,
      slug: `e2e-pdf-b-${run}`,
    }),
  );
  await signInAs(adminA, tenantA, 'CLIENT_ADMIN', 'AdminA');
  await signInAs(userA, tenantA, 'USER', 'UserA');
  await signInAs(adminB, tenantB, 'CLIENT_ADMIN', 'AdminB');
  colorPrinter = await printerWith(adminA, tenantA, 'COLOR', 'Couleur');
  monoPrinter = await printerWith(adminA, tenantA, 'MONOCHROME', 'Mono');
  printerB = await printerWith(adminB, tenantB, 'MONOCHROME', 'AutreB');
});

describe('analyse d’un PDF', () => {
  it('mesure chaque page et la moyenne du document', async () => {
    job = await created(
      adminA.upload<PrintJob>(
        api(tenantA, '/print-jobs'),
        { name: 'Plaquette été.pdf', data: PDF, type: 'application/pdf' },
        { printerId: colorPrinter.id, copies: '10' },
      ),
    );

    expect(job).toMatchObject({
      name: 'Plaquette été.pdf',
      pageCount: 3,
      colorPages: 1,
      copies: 10,
      printer: { id: colorPrinter.id },
      method: 'pdfium-srgb/separation-reference-gcr100',
    });
    expect(job.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(job.formats).toEqual([
      { format: 'A4', pages: 2 },
      { format: 'A3', pages: 1 },
    ]);
    const [cyanPage, blackPage, blankPage] = job.pages;
    expect(cyanPage!.coverage.cyan).toBeCloseTo(50, PRECISION - 1);
    expect(blackPage!.coverage.black).toBeCloseTo(100, PRECISION);
    expect(blankPage).toMatchObject({ format: 'A3', orientation: 'portrait', isColor: false });
    expect(blankPage!.areaFactor).toBeCloseTo(2, 2);
    expect(job.averageCoverage.cyan).toBeCloseTo(12.5, PRECISION - 1);
    expect(job.averageCoverage.black).toBeCloseTo(25, PRECISION);
  });

  it('refuse un fichier qui n’est pas un PDF, ou l’absence de fichier', async () => {
    const text = await adminA.upload<{ message: string }>(api(tenantA, '/print-jobs'), {
      name: 'note.txt',
      data: Buffer.from('bonjour'),
      type: 'text/plain',
    });
    expect(text.status).toBe(400);
    expect(text.body.message).toBe("Le fichier n'est pas un PDF.");

    const empty = await adminA.post(api(tenantA, '/print-jobs'), {});
    expect(empty.status).toBe(400);
  });

  it('liste, renomme et compte les travaux', async () => {
    await ok(
      adminA.patch(api(tenantA, `/print-jobs/${job.id}`), { name: 'Plaquette', copies: 12 }),
    );
    const list = await ok(adminA.get<Page<PrintJobSummary>>(api(tenantA, '/print-jobs')));
    expect(list.items.find((item) => item.id === job.id)).toMatchObject({
      name: 'Plaquette',
      copies: 12,
    });
  });
});

describe('rapport de préproduction', () => {
  it('estime le toner et le coût sur une machine couleur', async () => {
    const estimate = await ok(
      adminA.get<PrintJobEstimate>(
        api(
          tenantA,
          `/print-jobs/${job.id}/estimate?printerId=${colorPrinter.id}&copies=10&useCalibration=false`,
        ),
      ),
    );
    const grams = Object.fromEntries(
      estimate.channels.map((item) => [item.channel, item.estimatedGrams]),
    );

    // 4 A4 × 10 exemplaires = 40 pages A4. Noir : 0,02 × 25 / 5 × 40 = 4 g.
    // Cyan : 1 A4 couleur × 10 = 10 pages, couverture 50 % : 0,02 × 50 / 5 × 10 = 2 g.
    expect(estimate.a4EquivalentPages).toBeCloseTo(40, 1);
    expect(estimate.grayscale).toBe(false);
    expect(grams.BLACK).toBeCloseTo(4, PRECISION);
    expect(grams.CYAN).toBeCloseTo(2, PRECISION);
    expect(grams.MAGENTA).toBe(0);
    // Coût : 4 × 0,30 + 2 × 0,20 = 1,60 ; soit 0,16 par exemplaire.
    expect(estimate.totals.costEstimated).toBeCloseTo(1.6, PRECISION);
    expect(estimate.costPerCopy).toBeCloseTo(0.16, 2);
    // Un exemplaire : la page noire porte 0,4 g de noir, la page cyan 0,2 g de cyan.
    expect(estimate.pages[1]!.grams.BLACK).toBeCloseTo(0.4, 2);
    expect(estimate.pages[0]!.grams.CYAN).toBeCloseTo(0.2, 2);
    expect(estimate.pages[2]!.totalGrams).toBe(0);
  });

  it('passe en niveaux de gris sur une machine noir et blanc', async () => {
    const estimate = await ok(
      adminA.get<PrintJobEstimate>(
        api(tenantA, `/print-jobs/${job.id}/estimate?printerId=${monoPrinter.id}&copies=10`),
      ),
    );
    // Cyan pur en gris : 1 − luminance = 21,26 % sur une demi-page, soit 10,63 % de la page.
    // Noir moyen : (10,63 + 100) / 4 = 27,66 % ; 0,02 × 27,66 / 5 × 40 = 4,43 g.
    expect(estimate.grayscale).toBe(true);
    expect(estimate.channels.map((item) => item.channel)).toEqual(['BLACK']);
    expect(estimate.channels[0]!.estimatedGrams).toBeCloseTo(4.43, PRECISION);
  });
});

describe('droits et isolation', () => {
  it('réserve l’analyse aux rôles autorisés', async () => {
    expect((await userA.get(api(tenantA, '/print-jobs'))).status).toBe(403);
  });

  it('répond 404 sur l’analyse d’une autre entreprise', async () => {
    expect((await adminB.get(api(tenantA, `/print-jobs/${job.id}`))).status).toBe(404);
    expect((await adminB.get(api(tenantB, `/print-jobs/${job.id}`))).status).toBe(404);
  });

  it('refuse la machine d’une autre entreprise, par l’API comme en base', async () => {
    const reply = await adminA.patch(api(tenantA, `/print-jobs/${job.id}`), {
      printerId: printerB.id,
    });
    expect(reply.status).toBe(400);

    const systemDb = createPrismaClient(requireEnv('DATABASE_SYSTEM_URL'));
    try {
      await expect(systemDb.$executeRaw`
        UPDATE print_jobs SET printer_id = ${printerB.id}::uuid WHERE id = ${job.id}::uuid`).rejects.toThrow(
        /Machine introuvable pour cette entreprise/,
      );
    } finally {
      await systemDb.$disconnect();
    }
  });

  it('supprime une analyse et ses pages', async () => {
    await ok(adminA.request('DELETE', api(tenantA, `/print-jobs/${job.id}`)), 204);
    expect((await adminA.get(api(tenantA, `/print-jobs/${job.id}`))).status).toBe(404);
  });
});
