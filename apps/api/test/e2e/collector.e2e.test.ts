import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@arksen/database';
import type {
  AgentConfiguration,
  AgentEnrollment,
  AgentEnrollmentCode,
  AgentEventsResult,
  AgentSyncLog,
  CollectorAgent,
  DiscoveredDevice,
  MeterReading,
  Page,
  PrinterDetail,
  PrinterModel,
  PrinterSnmpState,
  RejectedAgentEvent,
  Site,
  Tenant,
  UserAccount,
} from '@arksen/shared-types';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, requireEnv, WEB_URL, type Reply } from './client.js';

/**
 * Collecte SNMP (Phase 7) de bout en bout : déclaration d'un agent, enregistrement par code,
 * configuration SNMP, synchronisation idempotente de l'outbox, état des machines, découverte,
 * révocation et isolation. Les appels de l'agent passent par le relais du frontend, comme ceux
 * de l'agent Windows installé chez un client.
 *
 * Les événements envoyés ici sont ceux que produirait l'agent ; la collecte SNMP elle-même est
 * testée contre un vrai répondeur SNMP dans `services/collector/tests`.
 */
const run = Date.now().toString(36);
const PASSWORD = `e2e-mot-de-passe-${run}`;
const COMMUNITY = `lecture-${run}`;
const BLACK_OID = '1.3.6.1.4.1.99999.2.1.0';
const COLOR_OID = '1.3.6.1.4.1.99999.2.2.0';

const superAdmin = new Client('198.51.100.151');
const adminA = new Client('198.51.100.152');
const userA = new Client('198.51.100.153');
const adminB = new Client('198.51.100.154');

let tenantA: Tenant;
let tenantB: Tenant;
let siteA: Site;
let otherSiteA: Site;
let colorPrinter: PrinterDetail;
let otherSitePrinter: PrinterDetail;
let printerB: PrinterDetail;
let agent: CollectorAgent;
let token: string;

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

/** Requête de l'agent : sans cookie, authentifiée par son jeton. */
async function agentCall<T>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<Reply<T>> {
  const response = await fetch(`${WEB_URL}/backend/api/v1/agent/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '198.51.100.159',
      'X-Agent-Version': '0.1.0-e2e',
      'X-Agent-Hostname': 'POSTE-E2E',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
}

function agentEvent(type: string, printerId: string | null, payload: object, minutesAgo = 0) {
  return {
    id: randomUUID(),
    type,
    schemaVersion: 1,
    agentId: agent.id,
    printerId,
    occurredAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    payload,
  };
}

async function sendEvents(events: object[]) {
  return ok(agentCall<AgentEventsResult>('POST', '/events', { token, body: { events } }));
}

async function signInAs(client: Client, tenant: Tenant, role: string, label: string) {
  const user = await created(
    superAdmin.post<UserAccount>(api(tenant, '/users'), {
      name: `E2E ${label}`,
      email: `e2e-agent-${label.toLowerCase()}-${run}@arksen.test`,
      role,
      password: PASSWORD,
    }),
  );
  expect((await client.signIn(user.email, PASSWORD)).status).toBe(200);
}

async function printerIn(
  client: Client,
  tenant: Tenant,
  site: Site,
  model: PrinterModel,
  label: string,
): Promise<PrinterDetail> {
  const printer = await created(
    client.post<PrinterDetail>(api(tenant, '/printers'), {
      siteId: site.id,
      modelId: model.id,
      name: label,
      serialNumber: `E2E-${run}-${label}`,
    }),
  );
  await ok(
    client.request('PUT', api(tenant, `/printers/${printer.id}/connection`), {
      ipAddress: '192.0.2.10',
      snmpVersion: 'V2C',
      snmpCommunity: COMMUNITY,
    }),
  );
  return printer;
}

beforeAll(async () => {
  expect(
    (await superAdmin.signIn(requireEnv('SUPER_ADMIN_EMAIL'), requireEnv('SUPER_ADMIN_PASSWORD')))
      .status,
  ).toBe(200);
  tenantA = await created(
    superAdmin.post<Tenant>('/api/v1/tenants', {
      name: `E2E Collecte A ${run}`,
      slug: `e2e-agent-a-${run}`,
    }),
  );
  tenantB = await created(
    superAdmin.post<Tenant>('/api/v1/tenants', {
      name: `E2E Collecte B ${run}`,
      slug: `e2e-agent-b-${run}`,
    }),
  );
  await signInAs(adminA, tenantA, 'CLIENT_ADMIN', 'AdminA');
  await signInAs(userA, tenantA, 'USER', 'UserA');
  await signInAs(adminB, tenantB, 'CLIENT_ADMIN', 'AdminB');

  const model = await created(
    adminA.post<PrinterModel>(api(tenantA, '/printer-models'), {
      manufacturer: 'E2E Fabricant',
      name: `Couleur ${run}`,
      colorMode: 'COLOR',
      snmpBlackCounterOid: BLACK_OID,
      snmpColorCounterOid: `.${COLOR_OID}`,
    }),
  );
  expect(model).toMatchObject({ snmpBlackCounterOid: BLACK_OID, snmpColorCounterOid: COLOR_OID });
  siteA = await created(adminA.post<Site>(api(tenantA, '/sites'), { name: 'Siège' }));
  otherSiteA = await created(adminA.post<Site>(api(tenantA, '/sites'), { name: 'Agence' }));
  colorPrinter = await printerIn(adminA, tenantA, siteA, model, 'Couleur');
  otherSitePrinter = await printerIn(adminA, tenantA, otherSiteA, model, 'Agence');

  const modelB = await created(
    adminB.post<PrinterModel>(api(tenantB, '/printer-models'), {
      manufacturer: 'E2E Fabricant',
      name: `Mono ${run}`,
      colorMode: 'MONOCHROME',
    }),
  );
  const siteB = await created(adminB.post<Site>(api(tenantB, '/sites'), { name: 'Site B' }));
  printerB = await printerIn(adminB, tenantB, siteB, modelB, 'AutreB');
});

describe('enregistrement d’un agent', () => {
  let code: string;

  it('déclare l’agent et délivre un code à usage unique', async () => {
    const enrollment = await created(
      adminA.post<AgentEnrollmentCode>(api(tenantA, '/agents'), {
        name: 'Agent du siège',
        siteId: siteA.id,
      }),
    );
    expect(enrollment.enrollmentCode).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
    expect(enrollment.agent).toMatchObject({ status: 'PENDING', site: { id: siteA.id } });
    code = enrollment.enrollmentCode;
    agent = enrollment.agent;

    const duplicate = await adminA.post(api(tenantA, '/agents'), { name: 'Agent du siège' });
    expect(duplicate.status).toBe(409);
  });

  it('échange le code contre un jeton, une seule fois', async () => {
    const enrolled = await created(
      agentCall<AgentEnrollment>('POST', '/enroll', {
        body: { code: code.toLowerCase(), hostname: 'POSTE-E2E', version: '0.1.0' },
      }),
    );
    expect(enrolled).toMatchObject({ agentId: agent.id, tenantId: tenantA.id });
    token = enrolled.token;

    const again = await agentCall('POST', '/enroll', {
      body: { code, hostname: 'AUTRE', version: '0.1.0' },
    });
    expect(again.status).toBe(401);

    const list = await ok(adminA.get<CollectorAgent[]>(api(tenantA, '/agents')));
    expect(list.find((item) => item.id === agent.id)).toMatchObject({
      status: 'ACTIVE',
      hostname: 'POSTE-E2E',
      online: true,
      enrollmentExpiresAt: null,
    });
  });

  it('refuse un jeton absent ou inconnu', async () => {
    expect((await agentCall('GET', '/config')).status).toBe(401);
    const forged = `ark_${'x'.repeat(43)}`;
    expect((await agentCall('GET', '/config', { token: forged })).status).toBe(401);
  });

  it('remet à l’agent les machines de son site et leurs secrets SNMP', async () => {
    const configuration = await ok(agentCall<AgentConfiguration>('GET', '/config', { token }));
    expect(configuration.agent).toMatchObject({ id: agent.id, siteId: siteA.id });
    // L'agent du siège ne reçoit pas la machine de l'agence, ni celle d'une autre entreprise.
    expect(configuration.printers.map((printer) => printer.id)).toEqual([colorPrinter.id]);
    expect(configuration.printers[0]).toMatchObject({
      host: '192.0.2.10',
      colorMode: 'COLOR',
      snmp: { version: 'V2C', port: 161, community: COMMUNITY },
      counters: {
        totalOid: '1.3.6.1.2.1.43.10.2.1.4.1.1',
        blackOid: BLACK_OID,
        colorOid: COLOR_OID,
      },
    });
  });
});

describe('synchronisation de l’outbox', () => {
  const reading = () =>
    agentEvent(
      'meter.reading',
      colorPrinter.id,
      { totalCount: 152340, blackCount: 98340, colorCount: 54000 },
      5,
    );
  let first: ReturnType<typeof reading>;

  it('accepte un relevé et le range parmi les compteurs, source agent', async () => {
    first = reading();
    const result = await sendEvents([first]);
    expect(result.acks).toEqual([{ id: first.id, status: 'accepted' }]);

    const history = await ok(
      adminA.get<Page<MeterReading>>(api(tenantA, `/printers/${colorPrinter.id}/meter-readings`)),
    );
    expect(history.items[0]).toMatchObject({
      blackCount: 98340,
      colorCount: 54000,
      totalCount: 152340,
      source: 'AGENT',
    });
  });

  it('acquitte un renvoi comme doublon, sans second relevé', async () => {
    const result = await sendEvents([first, first]);
    expect(result.acks.map((ack) => ack.status)).toEqual(['duplicate', 'duplicate']);
    const history = await ok(
      adminA.get<Page<MeterReading>>(api(tenantA, `/printers/${colorPrinter.id}/meter-readings`)),
    );
    expect(history.total).toBe(1);
  });

  it('rejette individuellement les événements invalides ou hors périmètre', async () => {
    const valid = agentEvent('meter.reading', colorPrinter.id, {
      totalCount: 152500,
      blackCount: 98440,
      colorCount: 54060,
    });
    const noColor = agentEvent('meter.reading', colorPrinter.id, { totalCount: 1 }, 1);
    const otherSite = agentEvent('meter.reading', otherSitePrinter.id, {
      blackCount: 1,
      colorCount: 1,
    });
    const otherTenant = agentEvent('printer.status', printerB.id, { reachable: true });
    const malformed = { ...agentEvent('meter.reading', colorPrinter.id, {}), schemaVersion: 9 };
    const unknownType = agentEvent('printer.reboot', colorPrinter.id, {});
    const future = agentEvent('printer.status', colorPrinter.id, { reachable: true }, -60);

    const result = await sendEvents([
      valid,
      noColor,
      otherSite,
      otherTenant,
      malformed,
      unknownType,
      future,
    ]);
    const byId = new Map(result.acks.map((ack) => [ack.id, ack]));
    expect(byId.get(valid.id)?.status).toBe('accepted');
    expect(byId.get(noColor.id)).toMatchObject({ status: 'rejected' });
    expect(byId.get(noColor.id)?.error).toMatch(/OID/);
    expect(byId.get(otherSite.id)?.error).toBe('Machine inconnue pour cet agent.');
    expect(byId.get(otherTenant.id)?.error).toBe('Machine inconnue pour cet agent.');
    expect(byId.get(malformed.id)?.error).toMatch(/schemaVersion/);
    expect(byId.get(unknownType.id)?.status).toBe('rejected');
    expect(byId.get(future.id)?.error).toMatch(/futur/);

    // Un rejet est définitif : renvoyé, l'événement est de nouveau rejeté avec la même raison.
    const replay = await sendEvents([noColor]);
    expect(replay.acks[0]).toMatchObject({
      status: 'rejected',
      error: byId.get(noColor.id)?.error,
    });

    const rejected = await ok(
      adminA.get<Page<RejectedAgentEvent>>(api(tenantA, '/agents/rejected-events')),
    );
    expect(rejected.total).toBe(6);
    expect(rejected.items.find((item) => item.id === unknownType.id)?.type).toBe('printer.reboot');
  });

  it('tient le journal des synchronisations', async () => {
    const logs = await ok(adminA.get<Page<AgentSyncLog>>(api(tenantA, '/agents/sync-logs')));
    expect(logs.items[0]).toMatchObject({
      agentId: agent.id,
      received: 1,
      accepted: 0,
      duplicates: 0,
      rejected: 1,
    });
    expect(logs.items.map((log) => log.received)).toEqual([1, 7, 2, 1]);
  });
});

describe('état des machines et découverte', () => {
  it('enregistre le dernier état SNMP et la connectivité', async () => {
    const status = agentEvent('printer.status', colorPrinter.id, {
      reachable: true,
      deviceStatus: 'warning',
      printerStatus: 'idle',
      alerts: ['lowToner'],
      supplies: [
        {
          index: 1,
          description: 'Cyan',
          kind: 'tonerCartridge',
          channel: 'CYAN',
          levelPercent: 64,
        },
      ],
      totalCount: 152500,
      serialNumber: 'SIMCOL0001',
    });
    // Un état plus ancien, reçu après (reprise d'une coupure), ne le remplace pas.
    const older = agentEvent(
      'printer.status',
      colorPrinter.id,
      { reachable: false, error: 'Pas de réponse SNMP' },
      30,
    );
    await sendEvents([status]);
    await sendEvents([older]);

    const { state } = await ok(
      userA.get<{ state: PrinterSnmpState }>(
        api(tenantA, `/printers/${colorPrinter.id}/snmp-state`),
      ),
    );
    expect(state).toMatchObject({
      reachable: true,
      deviceStatus: 'warning',
      alerts: ['lowToner'],
      supplies: [{ channel: 'CYAN', levelPercent: 64 }],
      agent: { id: agent.id, name: 'Agent du siège' },
    });
    const printer = await ok(
      adminA.get<PrinterDetail>(api(tenantA, `/printers/${colorPrinter.id}`)),
    );
    expect(printer.connectivity).toBe('ONLINE');

    const unreachable = agentEvent('printer.status', colorPrinter.id, {
      reachable: false,
      error: 'Pas de réponse SNMP de 192.0.2.10:161',
    });
    await sendEvents([unreachable]);
    const after = await ok(adminA.get<PrinterDetail>(api(tenantA, `/printers/${colorPrinter.id}`)));
    expect(after.connectivity).toBe('OFFLINE');
  });

  it('rattache un équipement découvert par son numéro de série, et associe les autres', async () => {
    await sendEvents([
      agentEvent('device.discovered', null, {
        ipAddress: '192.0.2.10',
        serialNumber: colorPrinter.serialNumber.toLowerCase(),
        description: 'Multifonction (test)',
      }),
      agentEvent('device.discovered', null, {
        ipAddress: '192.0.2.77',
        serialNumber: 'INCONNU-77',
        macAddress: '00:11:22:AA:BB:77',
      }),
    ]);
    const devices = await ok(
      adminA.get<Page<DiscoveredDevice>>(api(tenantA, '/discovered-devices')),
    );
    const known = devices.items.find((device) => device.ipAddress === '192.0.2.10');
    const unknown = devices.items.find((device) => device.ipAddress === '192.0.2.77');
    expect(known?.printer?.id).toBe(colorPrinter.id);
    expect(unknown?.printer).toBeNull();

    const associated = await ok(
      adminA.patch<DiscoveredDevice>(api(tenantA, `/discovered-devices/${unknown!.id}`), {
        printerId: otherSitePrinter.id,
      }),
    );
    expect(associated.printer?.id).toBe(otherSitePrinter.id);
    const refused = await adminA.patch(api(tenantA, `/discovered-devices/${unknown!.id}`), {
      printerId: printerB.id,
    });
    expect(refused.status).toBe(400);
  });
});

describe('droits, révocation et isolation', () => {
  it('réserve les agents aux rôles autorisés', async () => {
    expect((await userA.get(api(tenantA, '/agents'))).status).toBe(403);
    expect((await userA.post(api(tenantA, '/agents'), { name: 'Pirate' })).status).toBe(403);
  });

  it('cache les agents et les équipements d’une autre entreprise', async () => {
    expect((await adminB.get(api(tenantA, '/agents'))).status).toBe(404);
    const own = await ok(adminB.get<CollectorAgent[]>(api(tenantB, '/agents')));
    expect(own).toEqual([]);
    const revoke = await adminB.post(api(tenantB, `/agents/${agent.id}/revoke`), {});
    expect(revoke.status).toBe(404);
  });

  it('isole les tables de la collecte en base (RLS)', async () => {
    const appDb = createPrismaClient(requireEnv('DATABASE_APP_URL'));
    try {
      const visible = await appDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantB.id}, true)`;
        return tx.$queryRaw<{ n: bigint }[]>`
          SELECT (SELECT count(*) FROM collector_agents)
               + (SELECT count(*) FROM agent_events)
               + (SELECT count(*) FROM printer_states)
               + (SELECT count(*) FROM discovered_devices) AS n`;
      });
      expect(Number(visible[0]!.n)).toBe(0);
    } finally {
      await appDb.$disconnect();
    }
  });

  it('révoque un agent immédiatement, puis le réenregistre avec un nouveau code', async () => {
    await ok(adminA.post(api(tenantA, `/agents/${agent.id}/revoke`), {}), 201);
    expect((await agentCall('GET', '/config', { token })).status).toBe(401);
    expect(
      (
        await agentCall('POST', '/events', {
          token,
          body: { events: [agentEvent('printer.status', colorPrinter.id, { reachable: true })] },
        })
      ).status,
    ).toBe(401);

    const renewed = await created(
      adminA.post<AgentEnrollmentCode>(api(tenantA, `/agents/${agent.id}/enrollment-code`), {}),
    );
    expect(renewed.agent.status).toBe('PENDING');
    const enrolled = await created(
      agentCall<AgentEnrollment>('POST', '/enroll', {
        body: { code: renewed.enrollmentCode, hostname: 'POSTE-E2E', version: '0.1.0' },
      }),
    );
    expect(enrolled.token).not.toBe(token);
    token = enrolled.token;
    expect((await agentCall('GET', '/config', { token })).status).toBe(200);
  });
});
