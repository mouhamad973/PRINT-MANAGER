import { Prisma, withTenant, type PrismaClient } from '@arksen/database';
import type { Page, UserAccount } from '@arksen/shared-types';
import type { ListQuery, UserCreateInput, UserUpdateInput } from '@arksen/validation';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AccountsService } from '../auth/accounts.service.js';
import type { Principal, RequestContext } from '../auth/principal.js';
import { PRISMA_APP } from '../database/database.module.js';

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

export function toUserAccount(row: UserRow): UserAccount {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

/**
 * Utilisateurs d'une entreprise. Lectures et modifications passent par le rôle soumis au RLS :
 * même avec un identifiant d'utilisateur d'une autre entreprise, PostgreSQL ne renvoie rien.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, query: ListQuery): Promise<Page<UserAccount>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const where: Prisma.UserWhereInput = {
        tenantId,
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.user.findMany({
          where,
          select: userSelect,
          orderBy: [{ status: 'asc' }, { name: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.user.count({ where }),
      ]);
      return { items: rows.map(toUserAccount), total, page: query.page, pageSize: query.pageSize };
    });
  }

  async get(tenantId: string, userId: string): Promise<UserAccount> {
    const row = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.user.findFirst({ where: { id: userId, tenantId }, select: userSelect }),
    );
    if (!row) {
      throw new NotFoundException('Utilisateur introuvable.');
    }
    return toUserAccount(row);
  }

  async create(
    tenantId: string,
    input: UserCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<UserAccount> {
    const tenant = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }),
    );
    if (!tenant) {
      throw new NotFoundException('Entreprise introuvable.');
    }
    const user = await this.accounts.createCredentialUser({ ...input, tenantId });
    await this.audit.record({
      action: 'user.created',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'user',
      targetId: user.id,
      metadata: { email: user.email, role: user.role },
      ...context,
    });
    return toUserAccount(user);
  }

  async update(
    tenantId: string,
    userId: string,
    input: UserUpdateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<UserAccount> {
    // Un administrateur ne peut pas se retirer ses propres droits ni se désactiver.
    if (userId === actor.userId && (input.role !== undefined || input.status !== undefined)) {
      throw new BadRequestException('Vous ne pouvez pas modifier votre propre rôle ou statut.');
    }
    const { before, after } = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const current = await tx.user.findFirst({
        where: { id: userId, tenantId },
        select: userSelect,
      });
      if (!current) {
        throw new NotFoundException('Utilisateur introuvable.');
      }
      const updated = await tx.user.update({
        where: { id: userId },
        data: input,
        select: userSelect,
      });
      return { before: current, after: updated };
    });

    if (input.status === 'DISABLED' && before.status !== 'DISABLED') {
      await this.accounts.revokeSessions(userId);
    }
    const changes = Object.fromEntries(
      (Object.keys(input) as (keyof UserUpdateInput)[])
        .filter((key) => before[key] !== after[key])
        .map((key) => [key, { from: before[key], to: after[key] }]),
    );
    await this.audit.record({
      action: 'user.updated',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'user',
      targetId: userId,
      metadata: { email: after.email, changes },
      ...context,
    });
    return toUserAccount(after);
  }

  async resetPassword(
    tenantId: string,
    userId: string,
    password: string,
    actor: Principal,
    context: RequestContext,
  ): Promise<void> {
    if (userId === actor.userId) {
      throw new BadRequestException('Modifiez votre propre mot de passe depuis votre profil.');
    }
    const user = await this.get(tenantId, userId);
    await this.accounts.resetPassword(userId, password);
    await this.audit.record({
      action: 'user.password_reset',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'user',
      targetId: userId,
      metadata: { email: user.email },
      ...context,
    });
  }
}
