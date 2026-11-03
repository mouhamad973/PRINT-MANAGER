import { createPrismaClient, withTenant, type PrismaClient } from '@arksen/database';
import type { AuditLogEntry, CurrentUser, Page, Tenant, UserAccount } from '@arksen/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, requireEnv } from './client.js';

/**
 * Isolation multi-tenant et sécurité de l'authentification, vérifiées sur la stack réelle :
 * relais du frontend, API, Better Auth et PostgreSQL avec ses politiques RLS.
 *
 * Les données créées portent le préfixe « e2e- » : ce sont des données de test.
 */
const run = Date.now().toString(36);
const PASSWORD = `e2e-mot-de-passe-${run}`;

const superAdmin = new Client();
let tenantA: Tenant;
let tenantB: Tenant;
let adminA: UserAccount;
let techA: UserAccount;
let userB: UserAccount;
const adminAClient = new Client();

async function createTenant(label: string): Promise<Tenant> {
  const reply = await superAdmin.post<Tenant>('/api/v1/tenants', {
    name: `E2E ${label} ${run}`,
    slug: `e2e-${label.toLowerCase()}-${run}`,
    city: 'Dakar',
  });
  expect(reply.status).toBe(201);
  return reply.body;
}

async function createUser(
  client: Client,
  tenantId: string,
  role: string,
  label: string,
): Promise<UserAccount> {
  const reply = await client.post<UserAccount>(`/api/v1/tenants/${tenantId}/users`, {
    name: `E2E ${label}`,
    email: `e2e-${label.toLowerCase()}-${run}@arksen.test`,
    role,
    password: PASSWORD,
  });
  expect(reply.status, JSON.stringify(reply.body)).toBe(201);
  return reply.body;
}

beforeAll(async () => {
  const signIn = await superAdmin.signIn(
    requireEnv('SUPER_ADMIN_EMAIL'),
    requireEnv('SUPER_ADMIN_PASSWORD'),
  );
  expect(signIn.status, 'connexion du Super Administrateur').toBe(200);

  tenantA = await createTenant('A');
  tenantB = await createTenant('B');
  adminA = await createUser(superAdmin, tenantA.id, 'CLIENT_ADMIN', 'AdminA');
  userB = await createUser(superAdmin, tenantB.id, 'USER', 'UserB');

  expect((await adminAClient.signIn(adminA.email, PASSWORD)).status).toBe(200);
  techA = await createUser(adminAClient, tenantA.id, 'TECHNICIAN', 'TechA');
});

describe('authentification', () => {
  it('établit l’identité et l’entreprise côté serveur', async () => {
    const me = await adminAClient.get<CurrentUser>('/api/v1/me');

    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('CLIENT_ADMIN');
    expect(me.body.tenant?.id).toBe(tenantA.id);
    expect(me.body.permissions).toContain('users:manage');
  });

  it('refuse l’inscription libre', async () => {
    const reply = await new Client().post('/api/auth/sign-up/email', {
      name: 'Intrus',
      email: `intrus-${run}@arksen.test`,
      password: PASSWORD,
    });
    expect(reply.status).toBeGreaterThanOrEqual(400);
    expect(reply.status).toBeLessThan(500);
  });

  it('refuse un mot de passe erroné sans révéler si le compte existe', async () => {
    const wrongPassword = await new Client().signIn(adminA.email, 'mauvais-mot-de-passe');
    const unknownAccount = await new Client().signIn(`inconnu-${run}@arksen.test`, PASSWORD);

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(unknownAccount.body).toEqual(wrongPassword.body);
  });

  it('déconnecte réellement la session', async () => {
    const client = new Client();
    await client.signIn(techA.email, PASSWORD);
    expect((await client.get('/api/v1/me')).status).toBe(200);

    await client.post('/api/auth/sign-out', {});

    expect((await client.get('/api/v1/me')).status).toBe(401);
  });
});

describe('isolation des entreprises (API)', () => {
  it('ne liste que les utilisateurs de sa propre entreprise', async () => {
    const reply = await adminAClient.get<Page<UserAccount>>(`/api/v1/tenants/${tenantA.id}/users`);

    expect(reply.status).toBe(200);
    expect(reply.body.items.map((user) => user.tenantId)).toEqual(
      reply.body.items.map(() => tenantA.id),
    );
    expect(reply.body.items.map((user) => user.id)).not.toContain(userB.id);
  });

  it('répond 404 sur toute ressource d’une autre entreprise', async () => {
    const attempts = await Promise.all([
      adminAClient.get(`/api/v1/tenants/${tenantB.id}`),
      adminAClient.get(`/api/v1/tenants/${tenantB.id}/users`),
      adminAClient.get(`/api/v1/tenants/${tenantB.id}/users/${userB.id}`),
      adminAClient.get(`/api/v1/tenants/${tenantB.id}/audit-logs`),
      adminAClient.post(`/api/v1/tenants/${tenantB.id}/users`, {
        name: 'Intrus',
        email: `intrus-b-${run}@arksen.test`,
        role: 'CLIENT_ADMIN',
        password: PASSWORD,
      }),
    ]);
    expect(attempts.map((reply) => reply.status)).toEqual([404, 404, 404, 404, 404]);
  });

  it('ne laisse pas atteindre l’utilisateur d’une autre entreprise via sa propre URL', async () => {
    const read = await adminAClient.get(`/api/v1/tenants/${tenantA.id}/users/${userB.id}`);
    const write = await adminAClient.patch(`/api/v1/tenants/${tenantA.id}/users/${userB.id}`, {
      status: 'DISABLED',
    });

    expect(read.status).toBe(404);
    expect(write.status).toBe(404);
  });

  it('ignore un tenantId glissé dans le corps de la requête', async () => {
    const reply = await adminAClient.post<UserAccount>(`/api/v1/tenants/${tenantA.id}/users`, {
      name: 'E2E Glisse',
      email: `e2e-glisse-${run}@arksen.test`,
      role: 'USER',
      password: PASSWORD,
      tenantId: tenantB.id,
    });

    expect(reply.status).toBe(201);
    expect(reply.body.tenantId).toBe(tenantA.id);
  });

  it('interdit à un administrateur client d’attribuer le rôle Super Administrateur', async () => {
    const reply = await adminAClient.post(`/api/v1/tenants/${tenantA.id}/users`, {
      name: 'E2E Escalade',
      email: `e2e-escalade-${run}@arksen.test`,
      role: 'SUPER_ADMIN',
      password: PASSWORD,
    });
    expect(reply.status).toBe(400);
  });

  it('réserve la gestion des entreprises à la plateforme', async () => {
    expect((await adminAClient.get('/api/v1/tenants')).status).toBe(403);
    expect((await adminAClient.get('/api/v1/audit-logs')).status).toBe(403);
    expect(
      (await adminAClient.patch(`/api/v1/tenants/${tenantA.id}`, { status: 'SUSPENDED' })).status,
    ).toBe(403);
  });

  it('applique les permissions du rôle à l’intérieur de l’entreprise', async () => {
    const technician = new Client();
    await technician.signIn(techA.email, PASSWORD);

    expect((await technician.get(`/api/v1/tenants/${tenantA.id}`)).status).toBe(200);
    expect((await technician.get(`/api/v1/tenants/${tenantA.id}/users`)).status).toBe(403);
  });

  it('trace les actions dans le journal de l’entreprise, sans celles des autres', async () => {
    const reply = await adminAClient.get<Page<AuditLogEntry>>(
      `/api/v1/tenants/${tenantA.id}/audit-logs?pageSize=100`,
    );

    expect(reply.status).toBe(200);
    const actions = reply.body.items.map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining(['tenant.created', 'user.created', 'auth.sign_in']),
    );
    expect(reply.body.items.every((entry) => entry.tenantId === tenantA.id)).toBe(true);
  });
});

describe('isolation des entreprises (PostgreSQL)', () => {
  let appDb: PrismaClient;
  let systemDb: PrismaClient;

  beforeAll(() => {
    appDb = createPrismaClient(requireEnv('DATABASE_APP_URL'));
    systemDb = createPrismaClient(requireEnv('DATABASE_SYSTEM_URL'));
  });

  afterAll(async () => {
    await Promise.all([appDb.$disconnect(), systemDb.$disconnect()]);
  });

  it('ne montre aucune ligne au rôle métier sans contexte d’entreprise', async () => {
    const [users, tenants, logs] = await Promise.all([
      appDb.user.count(),
      appDb.tenant.count(),
      appDb.auditLog.count(),
    ]);
    expect({ users, tenants, logs }).toEqual({ users: 0, tenants: 0, logs: 0 });
  });

  it('ne montre que les lignes de l’entreprise du contexte, même sans filtre', async () => {
    const users = await withTenant(appDb, tenantA.id, (tx) => tx.user.findMany());

    expect(users.length).toBeGreaterThan(0);
    expect(new Set(users.map((user) => user.tenantId))).toEqual(new Set([tenantA.id]));
  });

  it('empêche d’écrire une ligne dans une autre entreprise', async () => {
    await expect(
      withTenant(appDb, tenantA.id, (tx) =>
        tx.user.update({ where: { id: userB.id }, data: { name: 'Piraté' } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(appDb, tenantA.id, (tx) =>
        tx.auditLog.create({ data: { action: 'test.injection', tenantId: tenantB.id } }),
      ),
    ).rejects.toThrow();
  });

  it('interdit au rôle métier toute lecture des sessions et des mots de passe', async () => {
    await expect(appDb.session.count()).rejects.toThrow(/permission denied/);
    await expect(appDb.account.count()).rejects.toThrow(/permission denied/);
  });

  it('protège en RLS toute table portant une colonne tenant_id', async () => {
    const tables = await systemDb.$queryRaw<{ table_name: string; rls: boolean }[]>`
      SELECT c.table_name, t.relrowsecurity AS rls
      FROM information_schema.columns c
      JOIN pg_class t ON t.relname = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'`;

    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table.rls, `RLS absent sur ${table.table_name}`).toBe(true);
    }
  });

  it('garde le journal d’audit en ajout seul, même pour le rôle système', async () => {
    await expect(
      systemDb.auditLog.updateMany({
        where: { tenantId: tenantA.id },
        data: { action: 'falsifié' },
      }),
    ).rejects.toThrow(/ajout seul/);
    await expect(systemDb.auditLog.deleteMany({ where: { tenantId: tenantA.id } })).rejects.toThrow(
      /ajout seul/,
    );
  });
});

describe('désactivation et suspension', () => {
  it('déconnecte immédiatement un utilisateur désactivé et bloque sa reconnexion', async () => {
    const victim = await createUser(adminAClient, tenantA.id, 'USER', 'Desactive');
    const session = new Client();
    await session.signIn(victim.email, PASSWORD);
    expect((await session.get('/api/v1/me')).status).toBe(200);

    const disable = await adminAClient.patch(`/api/v1/tenants/${tenantA.id}/users/${victim.id}`, {
      status: 'DISABLED',
    });
    expect(disable.status).toBe(200);

    expect((await session.get('/api/v1/me')).status).toBe(401);
    expect((await new Client().signIn(victim.email, PASSWORD)).status).toBe(403);
  });

  it('empêche un administrateur de se désactiver lui-même', async () => {
    const reply = await adminAClient.patch(`/api/v1/tenants/${tenantA.id}/users/${adminA.id}`, {
      status: 'DISABLED',
    });
    expect(reply.status).toBe(400);
  });

  it('ferme toutes les sessions d’une entreprise suspendue', async () => {
    const suspend = await superAdmin.patch(`/api/v1/tenants/${tenantB.id}`, {
      status: 'SUSPENDED',
    });
    expect(suspend.status).toBe(200);

    expect((await new Client().signIn(userB.email, PASSWORD)).status).toBe(403);

    const reactivate = await superAdmin.patch(`/api/v1/tenants/${tenantB.id}`, {
      status: 'ACTIVE',
    });
    expect(reactivate.status).toBe(200);
    expect((await new Client().signIn(userB.email, PASSWORD)).status).toBe(200);
  });
});

describe('limitation des tentatives de connexion', () => {
  // En dernier : le blocage dure une minute pour cette adresse IP.
  it('bloque après cinq échecs en une minute', async () => {
    const attacker = `203.0.113.${(Date.now() % 250) + 1}`;
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      statuses.push(
        (await new Client(attacker).signIn(`force-brute-${run}@arksen.test`, 'mauvais')).status,
      );
    }
    expect(statuses).toContain(429);
  });
});
