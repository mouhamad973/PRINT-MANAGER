import { randomUUID } from 'node:crypto';
import { Prisma, withTenant, type PrismaClient, type TransactionClient } from '@arksen/database';
import {
  FORECAST_WINDOW_DAYS,
  type Page,
  type PaperForecast,
  type PaperMovement,
  type PaperStock,
  type PaperType,
} from '@arksen/shared-types';
import type {
  ListQuery,
  PaperStockCreateInput,
  PaperStockListQuery,
  PaperTypeCreateInput,
  PaperTypeUpdateInput,
  StockMovementCreateInput,
  StockTransferInput,
  StockUpdateInput,
} from '@arksen/validation';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AlertsService, stockLevel } from '../alerts/alerts.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { Principal, RequestContext } from '../auth/principal.js';
import { isUniqueViolation } from '../common/changes.js';
import { ConsumptionService } from '../consumption/consumption.service.js';
import { PRISMA_APP } from '../database/database.module.js';
import { ORDER_COVER_DAYS } from '../stocks/forecast.js';
import { insufficientStock } from '../stocks/stocks.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const stockInclude = {
  site: { select: { id: true, name: true } },
  paperType: {
    select: { id: true, name: true, format: true, sheetsPerReam: true, reamPrice: true },
  },
} as const;
type StockRow = Prisma.PaperStockGetPayload<{ include: typeof stockInclude }>;

/** Feuilles consommées par des pages, selon la part de recto verso (deux pages par feuille). */
export function sheetsFor(pages: number, duplexPercent: number): number {
  return pages * (1 - duplexPercent / 200);
}

@Injectable()
export class PaperService {
  private readonly logger = new Logger(PaperService.name);

  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    private readonly consumption: ConsumptionService,
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
  ) {}

  // -- Types de papier -----------------------------------------------------------------------

  async types(tenantId: string): Promise<PaperType[]> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const { currency } = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      });
      const rows = await tx.paperType.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' },
        include: {
          stocks: { select: { quantity: true } },
          _count: { select: { printers: true } },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        format: row.format,
        grammage: row.grammage,
        sheetsPerReam: row.sheetsPerReam,
        reamPrice: row.reamPrice === null ? null : Number(row.reamPrice),
        sheetPrice:
          row.reamPrice === null ? null : round(Number(row.reamPrice) / row.sheetsPerReam, 6),
        currency,
        notes: row.notes,
        stock: row.stocks.reduce((sum, stock) => sum + stock.quantity, 0),
        printers: row._count.printers,
        createdAt: row.createdAt.toISOString(),
      }));
    });
  }

  async createType(
    tenantId: string,
    input: PaperTypeCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<PaperType> {
    const row = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.paperType.create({ data: { tenantId, ...input } }),
    ).catch((error: unknown) => {
      throw isUniqueViolation(error)
        ? new ConflictException('Un papier porte déjà ce nom.')
        : error;
    });
    await this.record('paper.type_created', tenantId, 'paper_type', row.id, actor, context, {
      name: row.name,
      format: row.format,
    });
    return (await this.types(tenantId)).find((type) => type.id === row.id)!;
  }

  async updateType(
    tenantId: string,
    typeId: string,
    input: PaperTypeUpdateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<PaperType> {
    await withTenant(this.appPrisma, tenantId, async (tx) => {
      const found = await tx.paperType.findFirst({ where: { id: typeId, tenantId } });
      if (!found) throw new NotFoundException('Papier introuvable.');
      return tx.paperType.update({ where: { id: typeId }, data: input });
    }).catch((error: unknown) => {
      throw isUniqueViolation(error)
        ? new ConflictException('Un papier porte déjà ce nom.')
        : error;
    });
    await this.record('paper.type_updated', tenantId, 'paper_type', typeId, actor, context, {
      ...input,
    });
    return (await this.types(tenantId)).find((type) => type.id === typeId)!;
  }

  // -- Stocks --------------------------------------------------------------------------------

  /** Rames par jour, par site et par papier, d'après les pages des machines réglées sur ce papier. */
  private async rates(tenantId: string): Promise<Map<string, number>> {
    const rates = new Map<string, number>();
    const to = new Date();
    const from = new Date(to.getTime() - (FORECAST_WINDOW_DAYS - 1) * DAY_MS);
    let fleet;
    try {
      fleet = await this.consumption.fleetConsumption(tenantId, {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      });
    } catch (error) {
      this.logger.warn(`Prévision papier sans volumes : ${(error as Error).message}`);
      return rates;
    }
    const settings = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.printerCostSettings.findMany({
        where: { tenantId, paperTypeId: { not: null } },
        include: {
          printer: { select: { siteId: true } },
          paperType: { select: { sheetsPerReam: true } },
        },
      }),
    );
    const byPrinter = new Map(settings.map((item) => [item.printerId, item]));
    for (const printer of fleet.printers) {
      const setting = byPrinter.get(printer.printerId);
      if (!setting?.paperType || printer.pages.total <= 0) continue;
      const key = `${setting.printer.siteId}|${setting.paperTypeId}`;
      const reams =
        sheetsFor(printer.pages.total, Number(setting.duplexPercent)) /
        setting.paperType.sheetsPerReam /
        FORECAST_WINDOW_DAYS;
      rates.set(key, (rates.get(key) ?? 0) + reams);
    }
    return rates;
  }

  private async describe(tenantId: string, rows: StockRow[]): Promise<PaperStock[]> {
    if (!rows.length) return [];
    const rates = await this.rates(tenantId);
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const { currency } = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      });
      const receipts = await tx.paperMovement.findMany({
        where: {
          stockId: { in: rows.map((row) => row.id) },
          type: 'RECEIPT',
          unitCost: { not: null },
        },
        orderBy: { occurredAt: 'desc' },
        select: { stockId: true, unitCost: true },
      });
      const lastCost = new Map<string, number>();
      for (const receipt of receipts) {
        if (!lastCost.has(receipt.stockId)) lastCost.set(receipt.stockId, Number(receipt.unitCost));
      }
      const now = Date.now();
      return rows.map((row) => {
        const rate = rates.get(`${row.siteId}|${row.paperTypeId}`) ?? null;
        const unitCost =
          lastCost.get(row.id) ??
          (row.paperType.reamPrice === null ? null : Number(row.paperType.reamPrice));
        const target = Math.max(
          rate === null ? 0 : Math.ceil(rate * (row.leadTimeDays + ORDER_COVER_DAYS)),
          row.minQuantity > 0 ? row.minQuantity + 1 : 0,
        );
        const forecast: PaperForecast =
          rate === null
            ? {
                reamsPerDay: null,
                daysOfCover: null,
                stockoutAt: null,
                recommendedOrder: Math.max(0, target - row.quantity),
              }
            : {
                reamsPerDay: round(rate, 4),
                daysOfCover: round(row.quantity / rate, 1),
                stockoutAt: new Date(now + (row.quantity / rate) * DAY_MS).toISOString(),
                recommendedOrder: Math.max(0, target - row.quantity),
              };
        return {
          id: row.id,
          site: row.site,
          paperType: {
            id: row.paperType.id,
            name: row.paperType.name,
            format: row.paperType.format,
            sheetsPerReam: row.paperType.sheetsPerReam,
          },
          quantity: row.quantity,
          minQuantity: row.minQuantity,
          leadTimeDays: row.leadTimeDays,
          level: stockLevel(row.quantity, row.minQuantity),
          value: unitCost === null ? null : round(unitCost * row.quantity, 2),
          currency,
          forecast,
          updatedAt: row.updatedAt.toISOString(),
        };
      });
    });
  }

  async stocks(tenantId: string, query: PaperStockListQuery): Promise<Page<PaperStock>> {
    const rows = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.paperStock.findMany({
        where: {
          tenantId,
          ...(query.siteId ? { siteId: query.siteId } : {}),
          ...(query.search
            ? { paperType: { name: { contains: query.search, mode: 'insensitive' } } }
            : {}),
        },
        include: stockInclude,
        orderBy: [{ site: { name: 'asc' } }, { paperType: { name: 'asc' } }],
      }),
    );
    const page = rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    return {
      items: await this.describe(tenantId, page),
      total: rows.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async stock(tenantId: string, stockId: string): Promise<PaperStock> {
    const row = await withTenant(this.appPrisma, tenantId, (tx) =>
      this.find(tx, tenantId, stockId),
    );
    const [stock] = await this.describe(tenantId, [row]);
    return stock!;
  }

  async createStock(
    tenantId: string,
    input: PaperStockCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<PaperStock> {
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const site = await tx.site.findFirst({ where: { id: input.siteId, tenantId } });
      const type = await tx.paperType.findFirst({ where: { id: input.paperTypeId, tenantId } });
      if (!site || !type)
        throw new BadRequestException('Site ou papier introuvable dans cette entreprise.');
      const created = await tx.paperStock.create({
        data: { tenantId, ...input },
        include: stockInclude,
      });
      await this.alerts.evaluatePaperStock(tx, tenantId, created, label(created));
      return created;
    }).catch((error: unknown) => {
      throw isUniqueViolation(error)
        ? new ConflictException('Ce papier est déjà suivi sur ce site.')
        : error;
    });
    await this.record('paper.stock_created', tenantId, 'paper_stock', row.id, actor, context, {
      paper: row.paperType.name,
      site: row.site.name,
    });
    return this.stock(tenantId, row.id);
  }

  async updateStock(
    tenantId: string,
    stockId: string,
    input: StockUpdateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<PaperStock> {
    await withTenant(this.appPrisma, tenantId, async (tx) => {
      await this.find(tx, tenantId, stockId);
      const updated = await tx.paperStock.update({
        where: { id: stockId },
        data: input,
        include: stockInclude,
      });
      await this.alerts.evaluatePaperStock(tx, tenantId, updated, label(updated));
    });
    await this.record('paper.stock_updated', tenantId, 'paper_stock', stockId, actor, context, {
      ...input,
    });
    return this.stock(tenantId, stockId);
  }

  async movements(
    tenantId: string,
    stockId: string,
    query: ListQuery,
  ): Promise<Page<PaperMovement>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      await this.find(tx, tenantId, stockId);
      const where = { tenantId, stockId };
      const total = await tx.paperMovement.count({ where });
      const rows = await tx.paperMovement.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return {
        items: rows.map((row) => ({
          id: row.id,
          stockId: row.stockId,
          type: row.type,
          quantity: row.quantity,
          balanceAfter: row.balanceAfter,
          unitCost: row.unitCost === null ? null : Number(row.unitCost),
          reference: row.reference,
          notes: row.notes,
          occurredAt: row.occurredAt.toISOString(),
          createdByEmail: row.createdByEmail,
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async createMovement(
    tenantId: string,
    stockId: string,
    input: StockMovementCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<PaperStock> {
    const result = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const stock = await this.find(tx, tenantId, stockId);
      let quantity: number;
      if (input.type === 'RECEIPT') quantity = input.quantity;
      else if (input.type === 'ISSUE') quantity = -input.quantity;
      else {
        quantity = input.countedQuantity - stock.quantity;
        if (quantity === 0) {
          throw new BadRequestException('Le stock compté est égal au stock enregistré.');
        }
      }
      const created = await tx.paperMovement.create({
        data: {
          tenantId,
          stockId,
          type: input.type,
          quantity,
          unitCost: input.type === 'RECEIPT' ? (input.unitCost ?? null) : null,
          reference: input.type === 'ADJUSTMENT' ? null : input.reference,
          notes: input.notes,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
          createdById: actor.userId,
          createdByEmail: actor.email,
        },
      });
      const after = await this.find(tx, tenantId, stockId);
      await this.alerts.evaluatePaperStock(tx, tenantId, after, label(after));
      return { created, stock };
    }).catch((error: unknown) => {
      throw paperShortage(error) ?? error;
    });
    await this.record('paper.movement_created', tenantId, 'paper_stock', stockId, actor, context, {
      paper: result.stock.paperType.name,
      site: result.stock.site.name,
      type: input.type,
      quantity: result.created.quantity,
      balanceAfter: result.created.balanceAfter,
    });
    return this.stock(tenantId, stockId);
  }

  async transfer(
    tenantId: string,
    input: StockTransferInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<{ from: PaperStock; to: PaperStock }> {
    const result = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const from = await this.find(tx, tenantId, input.fromStockId);
      if (from.siteId === input.toSiteId) {
        throw new BadRequestException('Choisissez un autre site que celui de départ.');
      }
      const site = await tx.site.findFirst({ where: { id: input.toSiteId, tenantId } });
      if (!site) throw new BadRequestException('Site introuvable dans cette entreprise.');
      const to =
        (await tx.paperStock.findFirst({
          where: { tenantId, siteId: site.id, paperTypeId: from.paperTypeId },
          include: stockInclude,
        })) ??
        (await tx.paperStock.create({
          data: { tenantId, siteId: site.id, paperTypeId: from.paperTypeId },
          include: stockInclude,
        }));
      const common = {
        tenantId,
        transferId: randomUUID(),
        notes: input.notes,
        createdById: actor.userId,
        createdByEmail: actor.email,
      };
      await tx.paperMovement.create({
        data: { ...common, stockId: from.id, type: 'TRANSFER_OUT', quantity: -input.quantity },
      });
      await tx.paperMovement.create({
        data: { ...common, stockId: to.id, type: 'TRANSFER_IN', quantity: input.quantity },
      });
      for (const id of [from.id, to.id]) {
        const after = await this.find(tx, tenantId, id);
        await this.alerts.evaluatePaperStock(tx, tenantId, after, label(after));
      }
      return { from, to };
    }).catch((error: unknown) => {
      throw paperShortage(error) ?? error;
    });
    await this.record(
      'paper.transferred',
      tenantId,
      'paper_stock',
      result.from.id,
      actor,
      context,
      {
        paper: result.from.paperType.name,
        from: result.from.site.name,
        to: result.to.site.name,
        quantity: input.quantity,
      },
    );
    return {
      from: await this.stock(tenantId, result.from.id),
      to: await this.stock(tenantId, result.to.id),
    };
  }

  private async find(tx: TransactionClient, tenantId: string, stockId: string): Promise<StockRow> {
    const stock = await tx.paperStock.findFirst({
      where: { id: stockId, tenantId },
      include: stockInclude,
    });
    if (!stock) throw new NotFoundException('Stock de papier introuvable.');
    return stock;
  }

  private async record(
    action: string,
    tenantId: string,
    targetType: string,
    targetId: string,
    actor: Principal,
    context: RequestContext,
    metadata: Record<string, unknown>,
  ) {
    await this.audit.record({
      action,
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType,
      targetId,
      metadata,
      ...context,
    });
  }
}

/** Stock de papier insuffisant : même déclencheur que les toners, compté en rames. */
function paperShortage(error: unknown): BadRequestException | null {
  const insufficient = insufficientStock(error);
  return insufficient
    ? new BadRequestException(insufficient.message.replace('cartouche(s)', 'rame(s)'))
    : null;
}

function label(stock: StockRow): string {
  return `${stock.paperType.name} à ${stock.site.name}`;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
