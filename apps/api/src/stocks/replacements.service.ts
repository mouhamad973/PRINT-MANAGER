import { Prisma, withTenant, type PrismaClient, type TransactionClient } from '@arksen/database';
import type {
  CmykChannel,
  DetectedReplacement,
  Page,
  TonerReplacement,
} from '@arksen/shared-types';
import type { TonerReplacementCreateInput, TonerReplacementListQuery } from '@arksen/validation';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AlertsService } from '../alerts/alerts.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { Principal, RequestContext } from '../auth/principal.js';
import { PRISMA_APP } from '../database/database.module.js';
import { detectJumps } from './forecast.js';
import { insufficientStock, referenceKey } from './stocks.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Fenêtre des remontées de niveau proposées comme remplacements à enregistrer. */
const DETECTION_DAYS = 60;
/** Un remplacement enregistré à moins de 3 jours d'une remontée l'explique. */
const MATCH_MS = 3 * DAY_MS;

const replacementInclude = {
  printer: { select: { id: true, name: true, site: { select: { name: true } } } },
  stock: { select: { id: true, site: { select: { name: true } } } },
} as const;
type ReplacementRow = Prisma.TonerReplacementGetPayload<{ include: typeof replacementInclude }>;

@Injectable()
export class ReplacementsService {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, query: TonerReplacementListQuery): Promise<Page<TonerReplacement>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const where: Prisma.TonerReplacementWhereInput = {
        tenantId,
        cancelledAt: null,
        ...(query.printerId ? { printerId: query.printerId } : {}),
      };
      const total = await tx.tonerReplacement.count({ where });
      const rows = await tx.tonerReplacement.findMany({
        where,
        include: replacementInclude,
        orderBy: { replacedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      const items: TonerReplacement[] = [];
      for (const row of rows) {
        const previous = await tx.tonerReplacement.findFirst({
          where: {
            tenantId,
            printerId: row.printerId,
            channel: row.channel,
            cancelledAt: null,
            replacedAt: { lt: row.replacedAt },
          },
          orderBy: { replacedAt: 'desc' },
          select: { counter: true },
        });
        items.push(toReplacement(row, previous?.counter ?? null));
      }
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  /**
   * Enregistre un remplacement : le compteur du moment (rendement réel de la cartouche retirée),
   * la sortie de stock éventuelle, et la fin des alertes de niveau du canal.
   */
  async create(
    tenantId: string,
    input: TonerReplacementCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<TonerReplacement> {
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const printer = await tx.printer.findFirst({
        where: { id: input.printerId, tenantId },
        select: {
          id: true,
          name: true,
          model: {
            select: {
              colorMode: true,
              toners: { select: { channel: true, reference: true, yieldPages: true } },
            },
          },
        },
      });
      if (!printer) throw new BadRequestException('Machine introuvable dans cette entreprise.');
      if (printer.model.colorMode === 'MONOCHROME' && input.channel !== 'BLACK') {
        throw new BadRequestException('Une machine noir et blanc n’a que du toner noir.');
      }
      const toner = printer.model.toners.find((item) => item.channel === input.channel) ?? null;
      const replacedAt = new Date(input.replacedAt);

      let stock = null;
      if (input.stockId) {
        stock = await tx.tonerStock.findFirst({
          where: { id: input.stockId, tenantId },
          include: { site: { select: { name: true } } },
        });
        if (!stock) throw new BadRequestException('Article de stock introuvable.');
        if (!toner || referenceKey(stock.reference) !== referenceKey(toner.reference)) {
          throw new BadRequestException(
            `Ce stock contient ${stock.reference}, pas la cartouche de cette machine${toner ? ` (${toner.reference})` : ''}.`,
          );
        }
      }

      const reading = await tx.meterReading.findFirst({
        where: { tenantId, printerId: printer.id, readAt: { lte: replacedAt } },
        orderBy: { readAt: 'desc' },
        select: { blackCount: true, colorCount: true },
      });
      const counter = reading
        ? input.channel === 'BLACK'
          ? reading.blackCount
          : reading.colorCount
        : null;
      const level =
        input.previousLevelPercent ??
        (await this.levelBefore(tx, printer.id, input.channel, replacedAt));

      const created = await tx.tonerReplacement.create({
        data: {
          tenantId,
          printerId: printer.id,
          channel: input.channel,
          reference: toner?.reference ?? null,
          yieldPages: toner?.yieldPages ?? null,
          replacedAt,
          previousLevelPercent: level,
          counter,
          stockId: stock?.id ?? null,
          notes: input.notes,
          createdById: actor.userId,
          createdByEmail: actor.email,
        },
        include: replacementInclude,
      });
      if (stock) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            stockId: stock.id,
            type: 'INSTALLATION',
            quantity: -1,
            replacementId: created.id,
            occurredAt: replacedAt,
            createdById: actor.userId,
            createdByEmail: actor.email,
          },
        });
        const after = await tx.tonerStock.findUniqueOrThrow({ where: { id: stock.id } });
        await this.alerts.evaluateStock(tx, tenantId, after, stock.site.name);
      }
      await this.alerts.resolveTonerAlerts(tx, tenantId, printer.id, input.channel);
      return created;
    }).catch((error: unknown) => {
      throw insufficientStock(error) ?? error;
    });

    await this.audit.record({
      action: 'toner.replaced',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'printer',
      targetId: row.printerId,
      metadata: {
        printer: row.printer.name,
        channel: row.channel,
        reference: row.reference,
        fromStock: row.stock?.site.name ?? null,
      },
      ...context,
    });
    return this.get(tenantId, row.id);
  }

  async get(tenantId: string, replacementId: string): Promise<TonerReplacement> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const row = await tx.tonerReplacement.findFirst({
        where: { id: replacementId, tenantId },
        include: replacementInclude,
      });
      if (!row) throw new NotFoundException('Remplacement introuvable.');
      const previous = await tx.tonerReplacement.findFirst({
        where: {
          tenantId,
          printerId: row.printerId,
          channel: row.channel,
          cancelledAt: null,
          replacedAt: { lt: row.replacedAt },
        },
        orderBy: { replacedAt: 'desc' },
        select: { counter: true },
      });
      return toReplacement(row, previous?.counter ?? null);
    });
  }

  /** Annule un remplacement erroné ; la cartouche revient dans son stock. */
  async cancel(
    tenantId: string,
    replacementId: string,
    actor: Principal,
    context: RequestContext,
  ): Promise<void> {
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const replacement = await tx.tonerReplacement.findFirst({
        where: { id: replacementId, tenantId, cancelledAt: null },
        include: replacementInclude,
      });
      if (!replacement) throw new NotFoundException('Remplacement introuvable.');
      await tx.tonerReplacement.update({
        where: { id: replacementId },
        data: { cancelledAt: new Date(), cancelledByEmail: actor.email },
      });
      const installation = await tx.stockMovement.findFirst({
        where: { tenantId, replacementId, type: 'INSTALLATION' },
        select: { stockId: true },
      });
      if (installation) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            stockId: installation.stockId,
            type: 'CANCELLATION',
            quantity: 1,
            replacementId,
            notes: 'Annulation du remplacement',
            createdById: actor.userId,
            createdByEmail: actor.email,
          },
        });
        const after = await tx.tonerStock.findUniqueOrThrow({
          where: { id: installation.stockId },
          include: { site: { select: { name: true } } },
        });
        await this.alerts.evaluateStock(tx, tenantId, after, after.site.name);
      }
      return replacement;
    });
    await this.audit.record({
      action: 'toner.replacement_cancelled',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'printer',
      targetId: row.printerId,
      metadata: { printer: row.printer.name, channel: row.channel, replacedAt: row.replacedAt },
      ...context,
    });
  }

  /**
   * Remontées de niveau vues par l'agent sans remplacement enregistré à proximité : autant de
   * remplacements probables à confirmer. Rien n'est enregistré sans un utilisateur.
   */
  async detected(tenantId: string): Promise<DetectedReplacement[]> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const since = new Date(Date.now() - DETECTION_DAYS * DAY_MS);
      const levels = await tx.supplyLevelReading.findMany({
        where: { tenantId, observedAt: { gte: new Date(since.getTime() - 7 * DAY_MS) } },
        orderBy: { observedAt: 'asc' },
      });
      const replacements = await tx.tonerReplacement.findMany({
        where: {
          tenantId,
          cancelledAt: null,
          replacedAt: { gte: new Date(since.getTime() - MATCH_MS) },
        },
        select: { printerId: true, channel: true, replacedAt: true },
      });
      const series = new Map<string, { at: Date; level: number }[]>();
      for (const point of levels) {
        const key = `${point.printerId}|${point.channel}`;
        series.set(key, [
          ...(series.get(key) ?? []),
          { at: point.observedAt, level: Number(point.levelPercent) },
        ]);
      }
      const found: {
        printerId: string;
        channel: CmykChannel;
        at: Date;
        before: number;
        after: number;
      }[] = [];
      for (const [key, points] of series) {
        const [printerId, channel] = key.split('|') as [string, CmykChannel];
        for (const jump of detectJumps(points)) {
          if (jump.at < since) continue;
          const explained = replacements.some(
            (item) =>
              item.printerId === printerId &&
              item.channel === channel &&
              Math.abs(item.replacedAt.getTime() - jump.at.getTime()) <= MATCH_MS,
          );
          if (!explained) found.push({ printerId, channel, ...jump });
        }
      }
      if (!found.length) return [];
      const printers = await tx.printer.findMany({
        where: { tenantId, id: { in: [...new Set(found.map((item) => item.printerId))] } },
        select: { id: true, name: true },
      });
      const names = new Map(printers.map((printer) => [printer.id, printer]));
      return found
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, 50)
        .flatMap((item) => {
          const printer = names.get(item.printerId);
          return printer
            ? [
                {
                  printer,
                  channel: item.channel,
                  detectedAt: item.at.toISOString(),
                  levelBefore: item.before,
                  levelAfter: item.after,
                },
              ]
            : [];
        });
    });
  }

  /** Dernier niveau SNMP connu avant le remplacement. */
  private async levelBefore(
    tx: TransactionClient,
    printerId: string,
    channel: CmykChannel,
    before: Date,
  ): Promise<number | null> {
    const reading = await tx.supplyLevelReading.findFirst({
      where: { printerId, channel, observedAt: { lte: before } },
      orderBy: { observedAt: 'desc' },
      select: { levelPercent: true },
    });
    return reading ? Number(reading.levelPercent) : null;
  }
}

function toReplacement(row: ReplacementRow, previousCounter: number | null): TonerReplacement {
  const pages =
    previousCounter !== null && row.counter !== null ? row.counter - previousCounter : null;
  return {
    id: row.id,
    printer: { id: row.printer.id, name: row.printer.name, siteName: row.printer.site.name },
    channel: row.channel,
    reference: row.reference,
    replacedAt: row.replacedAt.toISOString(),
    previousLevelPercent:
      row.previousLevelPercent === null ? null : Number(row.previousLevelPercent),
    counter: row.counter,
    pagesSincePrevious: pages !== null && pages > 0 ? pages : null,
    yieldPages: row.yieldPages,
    stock: row.stock ? { id: row.stock.id, siteName: row.stock.site.name } : null,
    notes: row.notes,
    createdByEmail: row.createdByEmail,
  };
}
