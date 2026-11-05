import { Prisma, withTenant, type PrismaClient, type TransactionClient } from '@arksen/database';
import {
  ALERT_TYPES,
  TONER_EMPTY_PERCENT,
  TONER_LOW_PERCENT,
  type Alert,
  type AlertSeverity,
  type AlertSummary,
  type AlertType,
  type CmykChannel,
  type Page,
  type StockLevel,
} from '@arksen/shared-types';
import type { AlertListQuery } from '@arksen/validation';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Principal, RequestContext } from '../auth/principal.js';
import { PRISMA_APP } from '../database/database.module.js';

const CHANNEL_NAMES: Record<CmykChannel, string> = {
  CYAN: 'cyan',
  MAGENTA: 'magenta',
  YELLOW: 'jaune',
  BLACK: 'noir',
};

export interface AlertSpec {
  type: AlertType;
  severity: AlertSeverity;
  dedupeKey: string;
  title: string;
  message: string;
  printerId?: string | null;
  stockId?: string | null;
  siteId?: string | null;
  channel?: CmykChannel | null;
  paperStockId?: string | null;
  planId?: string | null;
}

const alertInclude = {
  printer: { select: { id: true, name: true } },
  site: { select: { id: true, name: true } },
} as const;
type AlertRow = Prisma.AlertGetPayload<{ include: typeof alertInclude }>;

/** Niveau d'un article selon son seuil : un seuil nul signifie « pas suivi ». */
export function stockLevel(quantity: number, minQuantity: number): StockLevel {
  if (minQuantity > 0 && quantity === 0) return 'OUT';
  if (minQuantity > 0 && quantity <= minQuantity) return 'LOW';
  return 'OK';
}

/**
 * Alertes : chacune correspond à une condition (sa clé de déduplication). Tant que la condition
 * dure, l'alerte reste unique et se met à jour ; dès qu'elle disparaît, l'alerte se résout
 * seule. Les opérations prennent la transaction de l'appelant : l'alerte suit exactement les
 * données qui la déclenchent.
 */
@Injectable()
export class AlertsService {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  /** Ouvre l'alerte, ou rafraîchit l'alerte active de même clé (une seule à la fois). */
  async raise(tx: TransactionClient, tenantId: string, spec: AlertSpec): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO alerts (id, tenant_id, type, severity, status, dedupe_key, title, message,
                          printer_id, stock_id, site_id, channel, paper_stock_id, plan_id,
                          opened_at, last_seen_at)
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${spec.type}, ${spec.severity}::"AlertSeverity",
              'OPEN', ${spec.dedupeKey}, ${spec.title}, ${spec.message},
              ${spec.printerId ?? null}::uuid, ${spec.stockId ?? null}::uuid,
              ${spec.siteId ?? null}::uuid, ${spec.channel ?? null}::"TonerChannel",
              ${spec.paperStockId ?? null}::uuid, ${spec.planId ?? null}::uuid, now(), now())
      ON CONFLICT (tenant_id, dedupe_key) WHERE status <> 'RESOLVED'
      DO UPDATE SET last_seen_at = now(), severity = EXCLUDED.severity,
                    title = EXCLUDED.title, message = EXCLUDED.message`;
  }

  /** Résout les alertes actives de ces clés : leur condition a disparu. */
  async resolve(tx: TransactionClient, tenantId: string, dedupeKeys: string[]): Promise<void> {
    if (!dedupeKeys.length) return;
    await tx.alert.updateMany({
      where: { tenantId, dedupeKey: { in: dedupeKeys }, status: { not: 'RESOLVED' } },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolution: 'auto' },
    });
  }

  /** Seuil minimum et rupture d'un article de stock. */
  async evaluateStock(
    tx: TransactionClient,
    tenantId: string,
    stock: { id: string; siteId: string; reference: string; quantity: number; minQuantity: number },
    siteName: string,
  ): Promise<void> {
    const low = `stock-low:${stock.id}`;
    const out = `stock-out:${stock.id}`;
    const level = stockLevel(stock.quantity, stock.minQuantity);
    const target = { stockId: stock.id, siteId: stock.siteId };
    if (level === 'OUT') {
      await this.resolve(tx, tenantId, [low]);
      await this.raise(tx, tenantId, {
        type: 'STOCK_OUT',
        severity: 'CRITICAL',
        dedupeKey: out,
        title: `Rupture de ${stock.reference} à ${siteName}`,
        message: `Plus aucune cartouche ${stock.reference} en stock (seuil : ${stock.minQuantity}).`,
        ...target,
      });
    } else if (level === 'LOW') {
      await this.resolve(tx, tenantId, [out]);
      await this.raise(tx, tenantId, {
        type: 'STOCK_LOW',
        severity: 'WARNING',
        dedupeKey: low,
        title: `Stock bas de ${stock.reference} à ${siteName}`,
        message: `${stock.quantity} cartouche(s) en stock pour un seuil de ${stock.minQuantity}.`,
        ...target,
      });
    } else {
      await this.resolve(tx, tenantId, [low, out]);
    }
  }

  /**
   * Niveau SNMP d'une cartouche : bientôt épuisée sous 10 %, épuisée sous 2 %. Ces niveaux sont
   * ceux que déclare la machine.
   */
  async evaluateTonerLevel(
    tx: TransactionClient,
    tenantId: string,
    printer: { id: string; name: string },
    channel: CmykChannel,
    levelPercent: number,
  ): Promise<void> {
    const low = `toner-low:${printer.id}:${channel}`;
    const empty = `toner-empty:${printer.id}:${channel}`;
    const name = CHANNEL_NAMES[channel];
    const target = { printerId: printer.id, channel };
    if (levelPercent <= TONER_EMPTY_PERCENT) {
      await this.resolve(tx, tenantId, [low]);
      await this.raise(tx, tenantId, {
        type: 'TONER_EMPTY',
        severity: 'CRITICAL',
        dedupeKey: empty,
        title: `Toner ${name} épuisé sur ${printer.name}`,
        message: `Niveau déclaré par la machine : ${levelPercent} %. Remplacez la cartouche.`,
        ...target,
      });
    } else if (levelPercent <= TONER_LOW_PERCENT) {
      await this.resolve(tx, tenantId, [empty]);
      await this.raise(tx, tenantId, {
        type: 'TONER_LOW',
        severity: 'WARNING',
        dedupeKey: low,
        title: `Toner ${name} bientôt épuisé sur ${printer.name}`,
        message: `Niveau déclaré par la machine : ${levelPercent} %. Prévoyez une cartouche.`,
        ...target,
      });
    } else {
      await this.resolve(tx, tenantId, [low, empty]);
    }
  }

  /** Seuil minimum et rupture d'un stock de papier, en rames. */
  async evaluatePaperStock(
    tx: TransactionClient,
    tenantId: string,
    stock: { id: string; siteId: string; quantity: number; minQuantity: number },
    label: string,
  ): Promise<void> {
    const low = `paper-low:${stock.id}`;
    const out = `paper-out:${stock.id}`;
    const level = stockLevel(stock.quantity, stock.minQuantity);
    const target = { paperStockId: stock.id, siteId: stock.siteId };
    if (level === 'OUT') {
      await this.resolve(tx, tenantId, [low]);
      await this.raise(tx, tenantId, {
        type: 'PAPER_OUT',
        severity: 'CRITICAL',
        dedupeKey: out,
        title: `Rupture de papier : ${label}`,
        message: `Plus aucune rame en stock (seuil : ${stock.minQuantity}).`,
        ...target,
      });
    } else if (level === 'LOW') {
      await this.resolve(tx, tenantId, [out]);
      await this.raise(tx, tenantId, {
        type: 'PAPER_LOW',
        severity: 'WARNING',
        dedupeKey: low,
        title: `Papier bas : ${label}`,
        message: `${stock.quantity} rame(s) en stock pour un seuil de ${stock.minQuantity}.`,
        ...target,
      });
    } else {
      await this.resolve(tx, tenantId, [low, out]);
    }
  }

  /** Une cartouche neuve met fin aux alertes de niveau de son canal. */
  async resolveTonerAlerts(
    tx: TransactionClient,
    tenantId: string,
    printerId: string,
    channel: CmykChannel,
  ): Promise<void> {
    await this.resolve(tx, tenantId, [
      `toner-low:${printerId}:${channel}`,
      `toner-empty:${printerId}:${channel}`,
    ]);
  }

  async list(tenantId: string, query: AlertListQuery): Promise<Page<Alert>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const status =
        query.status === 'ACTIVE' || query.status === undefined
          ? { not: 'RESOLVED' as const }
          : query.status;
      const search = query.search?.trim();
      const where: Prisma.AlertWhereInput = {
        tenantId,
        status,
        ...(query.type ? { type: query.type } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: 'insensitive' } },
                { message: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const total = await tx.alert.count({ where });
      const rows = await tx.alert.findMany({
        where,
        include: alertInclude,
        // Critiques d'abord, puis les plus récentes.
        orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return { items: rows.map(toAlert), total, page: query.page, pageSize: query.pageSize };
    });
  }

  async summary(tenantId: string): Promise<AlertSummary> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const groups = await tx.alert.groupBy({
        by: ['type', 'severity'],
        where: { tenantId, status: { not: 'RESOLVED' } },
        _count: { _all: true },
      });
      const byType = Object.fromEntries(ALERT_TYPES.map((type) => [type, 0])) as Record<
        AlertType,
        number
      >;
      let open = 0;
      let critical = 0;
      for (const group of groups) {
        byType[group.type as AlertType] += group._count._all;
        open += group._count._all;
        if (group.severity === 'CRITICAL') critical += group._count._all;
      }
      const stocks = await tx.tonerStock.findMany({
        where: { tenantId, minQuantity: { gt: 0 } },
        include: { site: { select: { name: true } } },
        orderBy: [{ quantity: 'asc' }, { reference: 'asc' }],
      });
      const criticalStocks = stocks
        .filter((stock) => stockLevel(stock.quantity, stock.minQuantity) !== 'OK')
        .slice(0, 10)
        .map((stock) => ({
          id: stock.id,
          reference: stock.reference,
          channel: stock.channel,
          quantity: stock.quantity,
          minQuantity: stock.minQuantity,
          level: stockLevel(stock.quantity, stock.minQuantity),
          siteName: stock.site.name,
        }));
      return { open, critical, byType, criticalStocks };
    });
  }

  async act(
    tenantId: string,
    alertId: string,
    action: 'acknowledge' | 'resolve',
    actor: Principal,
    context: RequestContext,
  ): Promise<Alert> {
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const alert = await tx.alert.findFirst({ where: { id: alertId, tenantId } });
      if (!alert) throw new NotFoundException('Alerte introuvable.');
      if (alert.status === 'RESOLVED')
        throw new BadRequestException('Cette alerte est déjà résolue.');
      return tx.alert.update({
        where: { id: alertId },
        data:
          action === 'acknowledge'
            ? {
                status: 'ACKNOWLEDGED',
                acknowledgedAt: new Date(),
                acknowledgedByEmail: actor.email,
              }
            : {
                status: 'RESOLVED',
                resolvedAt: new Date(),
                resolution: 'manual',
                resolvedByEmail: actor.email,
              },
        include: alertInclude,
      });
    });
    await this.audit.record({
      action: action === 'acknowledge' ? 'alert.acknowledged' : 'alert.resolved',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'alert',
      targetId: alertId,
      metadata: { title: row.title, type: row.type },
      ...context,
    });
    return toAlert(row);
  }
}

function toAlert(row: AlertRow): Alert {
  return {
    id: row.id,
    type: row.type as AlertType,
    severity: row.severity,
    status: row.status,
    title: row.title,
    message: row.message,
    printer: row.printer,
    stockId: row.stockId,
    site: row.site,
    channel: row.channel,
    paperStockId: row.paperStockId,
    planId: row.planId,
    openedAt: row.openedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    acknowledgedByEmail: row.acknowledgedByEmail,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolution: (row.resolution as Alert['resolution']) ?? null,
  };
}
