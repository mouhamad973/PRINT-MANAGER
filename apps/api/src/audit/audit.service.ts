import { Prisma, withTenant, type PrismaClient } from '@arksen/database';
import type { AuditLogEntry, Page } from '@arksen/shared-types';
import type { AuditExportQuery, ListQuery } from '@arksen/validation';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { PRISMA_APP, PRISMA_SYSTEM } from '../database/database.module.js';
import { csvTable } from '../reports/render-csv.js';

export interface AuditEvent {
  action: string;
  tenantId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const auditSelect = {
  id: true,
  tenantId: true,
  actorEmail: true,
  action: true,
  targetType: true,
  targetId: true,
  metadata: true,
  ipAddress: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

type AuditRow = Prisma.AuditLogGetPayload<{ select: typeof auditSelect }>;

function toEntry(row: AuditRow): AuditLogEntry {
  return {
    ...row,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Au-delà, l'export est refusé : il faut réduire la période. */
export const AUDIT_EXPORT_MAX_ROWS = 100_000;

const EXPORT_COLUMNS = [
  'Date (UTC)',
  'Entreprise',
  'Utilisateur',
  'Action',
  'Type de cible',
  'Cible',
  'Adresse IP',
  'Navigateur',
  'Détails',
];

function exportWhere(query: AuditExportQuery): Prisma.AuditLogWhereInput {
  const end = new Date(`${query.to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { createdAt: { gte: new Date(`${query.from}T00:00:00.000Z`), lt: end } };
}

function searchFilter(search: string | undefined): Prisma.AuditLogWhereInput {
  return search
    ? {
        OR: [
          { action: { contains: search, mode: 'insensitive' } },
          { actorEmail: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    @Inject(PRISMA_SYSTEM) private readonly systemPrisma: PrismaClient,
  ) {}

  /**
   * Enregistre un événement. Un échec est journalisé sans interrompre l'action métier :
   * l'audit ne doit jamais empêcher un utilisateur de travailler.
   */
  async record(event: AuditEvent): Promise<void> {
    try {
      await this.systemPrisma.auditLog.create({
        data: {
          action: event.action,
          tenantId: event.tenantId ?? null,
          actorUserId: event.actorUserId ?? null,
          actorEmail: event.actorEmail ?? null,
          targetType: event.targetType ?? null,
          targetId: event.targetId ?? null,
          metadata: (event.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
          ipAddress: event.ipAddress ?? null,
          userAgent: event.userAgent ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`Événement d'audit « ${event.action} » non enregistré : ${String(error)}`);
    }
  }

  /** Journal d'une entreprise, lu sous RLS. */
  listForTenant(tenantId: string, query: ListQuery): Promise<Page<AuditLogEntry>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const where = { tenantId, ...searchFilter(query.search) };
      const [rows, total] = await Promise.all([
        tx.auditLog.findMany({
          where,
          select: auditSelect,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.auditLog.count({ where }),
      ]);
      return { items: rows.map(toEntry), total, page: query.page, pageSize: query.pageSize };
    });
  }

  /** Journal complet de la plateforme : réservé au Super Administrateur. */
  async listPlatform(query: ListQuery): Promise<Page<AuditLogEntry>> {
    const where = searchFilter(query.search);
    const [rows, total] = await Promise.all([
      this.systemPrisma.auditLog.findMany({
        where,
        select: auditSelect,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.systemPrisma.auditLog.count({ where }),
    ]);
    return { items: rows.map(toEntry), total, page: query.page, pageSize: query.pageSize };
  }

  /** Export CSV du journal d'une entreprise, lu sous RLS. */
  exportForTenant(tenantId: string, query: AuditExportQuery): Promise<Buffer> {
    return withTenant(this.appPrisma, tenantId, (tx) =>
      this.exportRows(tx, { tenantId, ...exportWhere(query) }),
    );
  }

  /** Export CSV du journal de toute la plateforme. */
  exportPlatform(query: AuditExportQuery): Promise<Buffer> {
    return this.exportRows(this.systemPrisma, exportWhere(query));
  }

  private async exportRows(
    client: Prisma.TransactionClient,
    where: Prisma.AuditLogWhereInput,
  ): Promise<Buffer> {
    const count = await client.auditLog.count({ where });
    if (count > AUDIT_EXPORT_MAX_ROWS) {
      throw new BadRequestException(
        `La période contient ${count} entrées ; l'export en accepte ${AUDIT_EXPORT_MAX_ROWS} au plus. Réduisez la période.`,
      );
    }
    const rows = await client.auditLog.findMany({
      where,
      select: { ...auditSelect, userAgent: true, tenant: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return csvTable(
      EXPORT_COLUMNS,
      rows.map((row) => [
        row.createdAt.toISOString(),
        row.tenant?.name ?? 'Plateforme',
        row.actorEmail,
        row.action,
        row.targetType,
        row.targetId,
        row.ipAddress,
        row.userAgent,
        row.metadata === null ? null : JSON.stringify(row.metadata),
      ]),
    );
  }
}
