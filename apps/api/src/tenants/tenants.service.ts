import { Prisma, withTenant, type PrismaClient } from '@arksen/database';
import type { Page, Tenant } from '@arksen/shared-types';
import type { TenantCreateInput, TenantListQuery, TenantUpdateInput } from '@arksen/validation';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Principal, RequestContext } from '../auth/principal.js';
import { PRISMA_APP, PRISMA_SYSTEM } from '../database/database.module.js';

const tenantSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  address: true,
  city: true,
  country: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { users: true } },
} satisfies Prisma.TenantSelect;

type TenantRow = Prisma.TenantGetPayload<{ select: typeof tenantSelect }>;

function toTenant({ _count, createdAt, updatedAt, ...row }: TenantRow): Tenant {
  return {
    ...row,
    userCount: _count.users,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

@Injectable()
export class TenantsService {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    @Inject(PRISMA_SYSTEM) private readonly systemPrisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  /** Liste transverse : réservée au Super Administrateur, d'où le client système. */
  async list(query: TenantListQuery): Promise<Page<Tenant>> {
    const where: Prisma.TenantWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
              { city: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.systemPrisma.tenant.findMany({
        where,
        select: tenantSelect,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.systemPrisma.tenant.count({ where }),
    ]);
    return { items: rows.map(toTenant), total, page: query.page, pageSize: query.pageSize };
  }

  /** Lecture sous RLS : seule l'entreprise du contexte est visible. */
  async get(tenantId: string): Promise<Tenant> {
    const row = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: tenantSelect }),
    );
    if (!row) {
      throw new NotFoundException('Entreprise introuvable.');
    }
    return toTenant(row);
  }

  async create(
    input: TenantCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<Tenant> {
    try {
      const row = await this.systemPrisma.tenant.create({ data: input, select: tenantSelect });
      await this.audit.record({
        action: 'tenant.created',
        tenantId: row.id,
        actorUserId: actor.userId,
        actorEmail: actor.email,
        targetType: 'tenant',
        targetId: row.id,
        metadata: { name: row.name, slug: row.slug },
        ...context,
      });
      return toTenant(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Cet identifiant d’entreprise est déjà utilisé.');
      }
      throw error;
    }
  }

  async update(
    tenantId: string,
    input: TenantUpdateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<Tenant> {
    const before = await this.systemPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    if (!before) {
      throw new NotFoundException('Entreprise introuvable.');
    }
    const row = await this.systemPrisma.tenant.update({
      where: { id: tenantId },
      data: input,
      select: tenantSelect,
    });
    // Une suspension ferme immédiatement toutes les sessions de l'entreprise.
    if (input.status === 'SUSPENDED' && before.status !== 'SUSPENDED') {
      await this.systemPrisma.session.deleteMany({ where: { user: { tenantId } } });
    }
    const statusChanged = input.status !== undefined && input.status !== before.status;
    await this.audit.record({
      action: statusChanged
        ? input.status === 'SUSPENDED'
          ? 'tenant.suspended'
          : 'tenant.reactivated'
        : 'tenant.updated',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'tenant',
      targetId: tenantId,
      metadata: { fields: Object.keys(input) },
      ...context,
    });
    return toTenant(row);
  }
}
