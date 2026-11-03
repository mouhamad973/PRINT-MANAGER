import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service.js';
import type { AccountsService } from '../auth/accounts.service.js';
import type { Principal } from '../auth/principal.js';
import { UsersService } from './users.service.js';

const TENANT = '0190f0a0-0000-7000-8000-00000000000a';
const admin: Principal = {
  userId: 'admin-1',
  email: 'admin@a.test',
  name: 'Admin',
  role: 'CLIENT_ADMIN',
  tenantId: TENANT,
  sessionId: 's',
};
const context = { ipAddress: '10.0.0.1', userAgent: 'test' };
const now = new Date('2026-11-03T10:00:00Z');
const target = {
  id: 'user-2',
  name: 'Technicien',
  email: 'tech@a.test',
  role: 'TECHNICIAN' as const,
  status: 'ACTIVE' as const,
  tenantId: TENANT,
  createdAt: now,
  updatedAt: now,
};

const tx = {
  $executeRaw: vi.fn(),
  user: { findFirst: vi.fn(), update: vi.fn() },
  tenant: { findUnique: vi.fn() },
};
const appPrisma = { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) };
const accounts = { createCredentialUser: vi.fn(), resetPassword: vi.fn(), revokeSessions: vi.fn() };
const audit = { record: vi.fn() };

const service = new UsersService(
  appPrisma as never,
  accounts as unknown as AccountsService,
  audit as unknown as AuditService,
);

describe('UsersService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.user.findFirst.mockResolvedValue(target);
  });

  it('exécute chaque lecture dans le contexte RLS de l’entreprise', async () => {
    await service.get(TENANT, target.id);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, tenantId] = tx.$executeRaw.mock.calls[0]!;
    expect((strings as string[]).join('?')).toContain("set_config('app.tenant_id'");
    expect(tenantId).toBe(TENANT);
  });

  it('empêche un administrateur de modifier son propre rôle', async () => {
    await expect(
      service.update(TENANT, admin.userId, { role: 'USER' }, admin, context),
    ).rejects.toThrow(BadRequestException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('empêche un administrateur de se désactiver', async () => {
    await expect(
      service.update(TENANT, admin.userId, { status: 'DISABLED' }, admin, context),
    ).rejects.toThrow(BadRequestException);
  });

  it('ferme les sessions d’un utilisateur désactivé et trace le changement', async () => {
    tx.user.update.mockResolvedValue({ ...target, status: 'DISABLED' });

    await service.update(TENANT, target.id, { status: 'DISABLED' }, admin, context);

    expect(accounts.revokeSessions).toHaveBeenCalledWith(target.id);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.updated',
        tenantId: TENANT,
        targetId: target.id,
        metadata: expect.objectContaining({
          changes: { status: { from: 'ACTIVE', to: 'DISABLED' } },
        }),
      }),
    );
  });

  it('répond 404 pour un utilisateur invisible dans le contexte de l’entreprise', async () => {
    tx.user.findFirst.mockResolvedValue(null);

    await expect(
      service.update(TENANT, 'autre-entreprise', { name: 'X Y' }, admin, context),
    ).rejects.toThrow(NotFoundException);
  });

  it('crée l’utilisateur dans l’entreprise de l’URL, jamais dans une autre', async () => {
    tx.tenant.findUnique.mockResolvedValue({ id: TENANT });
    accounts.createCredentialUser.mockResolvedValue(target);

    await service.create(
      TENANT,
      { name: 'Tech', email: 'tech@a.test', role: 'TECHNICIAN', password: 'un-mot-de-passe-long' },
      admin,
      context,
    );

    expect(accounts.createCredentialUser).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, role: 'TECHNICIAN' }),
    );
  });

  it('refuse qu’un administrateur réinitialise son propre mot de passe ici', async () => {
    await expect(
      service.resetPassword(TENANT, admin.userId, 'un-mot-de-passe-long', admin, context),
    ).rejects.toThrow(BadRequestException);
  });
});
