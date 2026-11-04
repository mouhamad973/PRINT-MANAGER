import { Prisma, withTenant, type PrismaClient } from '@arksen/database';
import type { Page, Site } from '@arksen/shared-types';
import type { ListQuery, SiteCreateInput, SiteUpdateInput } from '@arksen/validation';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Principal, RequestContext } from '../auth/principal.js';
import { diffChanges, isUniqueViolation } from '../common/changes.js';
import { PRISMA_APP } from '../database/database.module.js';

const siteInclude = { _count: { select: { printers: true } } } satisfies Prisma.SiteInclude;
type SiteRow = Prisma.SiteGetPayload<{ include: typeof siteInclude }>;

function toSite({ _count, ...row }: SiteRow): Site {
  return {
    ...row,
    printerCount: _count.printers,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const DUPLICATE_NAME = 'Un site porte déjà ce nom dans cette entreprise.';

/** Sites d'une entreprise, lus et écrits sous Row-Level Security. */
@Injectable()
export class SitesService {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, query: ListQuery): Promise<Page<Site>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const where: Prisma.SiteWhereInput = {
        tenantId,
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { code: { contains: query.search, mode: 'insensitive' } },
                { city: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.site.findMany({
          where,
          include: siteInclude,
          orderBy: { name: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.site.count({ where }),
      ]);
      return { items: rows.map(toSite), total, page: query.page, pageSize: query.pageSize };
    });
  }

  async get(tenantId: string, siteId: string): Promise<Site> {
    const row = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.site.findFirst({ where: { id: siteId, tenantId }, include: siteInclude }),
    );
    if (!row) {
      throw new NotFoundException('Site introuvable.');
    }
    return toSite(row);
  }

  async create(
    tenantId: string,
    input: SiteCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<Site> {
    const site = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.site.create({ data: { ...input, tenantId }, include: siteInclude }),
    ).catch((error: unknown) => {
      throw isUniqueViolation(error) ? new ConflictException(DUPLICATE_NAME) : error;
    });
    await this.audit.record({
      action: 'site.created',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'site',
      targetId: site.id,
      metadata: { name: site.name },
      ...context,
    });
    return toSite(site);
  }

  async update(
    tenantId: string,
    siteId: string,
    input: SiteUpdateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<Site> {
    const { before, after } = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const current = await tx.site.findFirst({ where: { id: siteId, tenantId } });
      if (!current) {
        throw new NotFoundException('Site introuvable.');
      }
      const updated = await tx.site.update({
        where: { id: siteId },
        data: input,
        include: siteInclude,
      });
      return { before: current, after: updated };
    }).catch((error: unknown) => {
      throw isUniqueViolation(error) ? new ConflictException(DUPLICATE_NAME) : error;
    });
    await this.audit.record({
      action: 'site.updated',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'site',
      targetId: siteId,
      metadata: { name: after.name, changes: diffChanges(Object.keys(input), before, after) },
      ...context,
    });
    return toSite(after);
  }

  /** Un site qui porte encore des machines, même retirées, n'est pas supprimé : leur historique y reste rattaché. */
  async remove(
    tenantId: string,
    siteId: string,
    actor: Principal,
    context: RequestContext,
  ): Promise<void> {
    const site = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const current = await tx.site.findFirst({
        where: { id: siteId, tenantId },
        include: siteInclude,
      });
      if (!current) {
        throw new NotFoundException('Site introuvable.');
      }
      const count = current._count.printers;
      if (count > 0) {
        throw new ConflictException(
          `Ce site porte encore ${count} machine${count > 1 ? 's' : ''}. Rattachez-les à un autre site avant de le supprimer.`,
        );
      }
      await tx.site.delete({ where: { id: siteId } });
      return current;
    });
    await this.audit.record({
      action: 'site.deleted',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'site',
      targetId: siteId,
      metadata: { name: site.name },
      ...context,
    });
  }
}
