import { randomUUID } from 'node:crypto';
import { Prisma, withTenant, type PrismaClient, type TransactionClient } from '@arksen/database';
import {
  FORECAST_WINDOW_DAYS,
  type CmykChannel,
  type Page,
  type StockMovement,
  type TonerReference,
  type TonerStock,
} from '@arksen/shared-types';
import type {
  ListQuery,
  StockCreateInput,
  StockListQuery,
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
import { stockForecast } from './forecast.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Clé de comparaison d'une référence : sans casse ni espaces autour. */
export function referenceKey(reference: string): string {
  return reference.trim().toUpperCase();
}

/** Erreur levée par le déclencheur du registre quand une sortie viderait le stock. */
export function insufficientStock(error: unknown): BadRequestException | null {
  const text = error instanceof Error ? error.message : String(error);
  const match = /Stock insuffisant : (\d+)/.exec(text);
  return match
    ? new BadRequestException(`Stock insuffisant : ${match[1]} cartouche(s) disponible(s).`)
    : null;
}

interface ReferenceInfo {
  reference: string;
  channel: CmykChannel;
  capacityGrams: number;
  yieldPages: number;
  modelIds: Set<string>;
  models: { id: string; name: string }[];
  unitPrice: number | null;
}

const stockInclude = { site: { select: { id: true, name: true } } } as const;
type StockRow = Prisma.TonerStockGetPayload<{ include: typeof stockInclude }>;

@Injectable()
export class StocksService {
  private readonly logger = new Logger(StocksService.name);

  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    private readonly consumption: ConsumptionService,
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
  ) {}

  /** Références de toner des fiches techniques visibles par l'entreprise. */
  private async referenceIndex(tx: TransactionClient, tenantId: string) {
    const toners = await tx.tonerModel.findMany({
      where: { OR: [{ tenantId: null }, { tenantId }] },
      include: { printerModel: { select: { id: true, manufacturer: true, name: true } } },
      orderBy: { reference: 'asc' },
    });
    const prices = await tx.tonerPrice.findMany({ where: { tenantId } });
    const priceByToner = new Map(
      prices.map((price) => [price.tonerModelId, Number(price.unitPrice)]),
    );
    const index = new Map<string, ReferenceInfo>();
    for (const toner of toners) {
      const key = referenceKey(toner.reference);
      const info = index.get(key) ?? {
        reference: toner.reference.trim(),
        channel: toner.channel,
        capacityGrams: Number(toner.capacityGrams),
        yieldPages: toner.yieldPages,
        modelIds: new Set<string>(),
        models: [],
        unitPrice: null,
      };
      if (!info.modelIds.has(toner.printerModelId)) {
        info.modelIds.add(toner.printerModelId);
        info.models.push({
          id: toner.printerModel.id,
          name: `${toner.printerModel.manufacturer} ${toner.printerModel.name}`,
        });
      }
      info.unitPrice ??= priceByToner.get(toner.id) ?? null;
      index.set(key, info);
    }
    return index;
  }

  async references(tenantId: string): Promise<TonerReference[]> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const index = await this.referenceIndex(tx, tenantId);
      const { currency } = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      });
      const printers = await tx.printer.findMany({
        where: { tenantId, status: { not: 'RETIRED' } },
        select: { modelId: true },
      });
      const stocks = await tx.tonerStock.findMany({
        where: { tenantId },
        select: { reference: true, quantity: true },
      });
      const replacements = await tx.tonerReplacement.findMany({
        where: {
          tenantId,
          cancelledAt: null,
          replacedAt: { gte: new Date(Date.now() - 365 * DAY_MS) },
        },
        select: {
          printerId: true,
          channel: true,
          replacedAt: true,
          counter: true,
          reference: true,
        },
        orderBy: { replacedAt: 'asc' },
      });

      const recentSince = Date.now() - FORECAST_WINDOW_DAYS * DAY_MS;
      const recent = new Map<string, number>();
      const yields = new Map<string, number[]>();
      const previous = new Map<string, (typeof replacements)[number]>();
      for (const replacement of replacements) {
        const key = replacement.reference ? referenceKey(replacement.reference) : null;
        if (key && replacement.replacedAt.getTime() >= recentSince) {
          recent.set(key, (recent.get(key) ?? 0) + 1);
        }
        // Le rendement mesuré au remplacement est celui de la cartouche retirée.
        const cartridge = `${replacement.printerId}:${replacement.channel}`;
        const before = previous.get(cartridge);
        if (before?.reference && before.counter !== null && replacement.counter !== null) {
          const pages = replacement.counter - before.counter;
          if (pages > 0) {
            const beforeKey = referenceKey(before.reference);
            yields.set(beforeKey, [...(yields.get(beforeKey) ?? []), pages]);
          }
        }
        previous.set(cartridge, replacement);
      }

      return [...index.entries()].map(([key, info]) => {
        const samples = yields.get(key) ?? [];
        return {
          reference: info.reference,
          channel: info.channel,
          capacityGrams: info.capacityGrams,
          yieldPages: info.yieldPages,
          models: info.models,
          printers: printers.filter((printer) => info.modelIds.has(printer.modelId)).length,
          unitPrice: info.unitPrice,
          currency,
          stock: stocks
            .filter((stock) => referenceKey(stock.reference) === key)
            .reduce((sum, stock) => sum + stock.quantity, 0),
          replacements90d: recent.get(key) ?? 0,
          averageYield: samples.length
            ? Math.round(samples.reduce((sum, pages) => sum + pages, 0) / samples.length)
            : null,
          yieldSamples: samples.length,
        };
      });
    });
  }

  /**
   * Cartouches consommées par jour, par site et par référence, selon le moteur CMJN : la
   * consommation estimée (pages relevées, aplat, calibration) des machines équipées sur la
   * fenêtre d'observation, divisée par la masse de toner d'une cartouche.
   */
  private async engineRates(tenantId: string): Promise<Map<string, number> | null> {
    const to = new Date();
    const from = new Date(to.getTime() - (FORECAST_WINDOW_DAYS - 1) * DAY_MS);
    let fleet;
    try {
      fleet = await this.consumption.fleetConsumption(tenantId, {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      });
    } catch (error) {
      this.logger.warn(`Prévisions sans le moteur CMJN : ${(error as Error).message}`);
      return null;
    }
    const printers = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.printer.findMany({
        where: { tenantId },
        select: {
          id: true,
          siteId: true,
          model: {
            select: { toners: { select: { channel: true, reference: true, capacityGrams: true } } },
          },
        },
      }),
    );
    const byId = new Map(printers.map((printer) => [printer.id, printer]));
    const rates = new Map<string, number>();
    for (const consumption of fleet.printers) {
      const printer = byId.get(consumption.printerId);
      if (!printer) continue;
      for (const channel of consumption.channels) {
        const toner = printer.model.toners.find((item) => item.channel === channel.channel);
        if (!toner || channel.estimatedGrams <= 0) continue;
        const key = `${printer.siteId}|${referenceKey(toner.reference)}`;
        const perDay = channel.estimatedGrams / Number(toner.capacityGrams) / FORECAST_WINDOW_DAYS;
        rates.set(key, (rates.get(key) ?? 0) + perDay);
      }
    }
    return rates;
  }

  /** Articles avec leur niveau, leur valeur et leur prévision de rupture. */
  private async describe(tenantId: string, rows: StockRow[]): Promise<TonerStock[]> {
    if (!rows.length) return [];
    const rates = await this.engineRates(tenantId);
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const index = await this.referenceIndex(tx, tenantId);
      const { currency } = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      });
      const ids = rows.map((row) => row.id);
      const since = new Date(Date.now() - FORECAST_WINDOW_DAYS * DAY_MS);
      const installations = await tx.stockMovement.groupBy({
        by: ['stockId'],
        where: {
          stockId: { in: ids },
          type: { in: ['INSTALLATION', 'CANCELLATION'] },
          occurredAt: { gte: since },
        },
        _sum: { quantity: true },
      });
      const installed = new Map(
        installations.map((item) => [item.stockId, -(item._sum.quantity ?? 0)]),
      );
      const receipts = await tx.stockMovement.findMany({
        where: { stockId: { in: ids }, type: 'RECEIPT', unitCost: { not: null } },
        orderBy: { occurredAt: 'desc' },
        select: { stockId: true, unitCost: true },
      });
      const lastCost = new Map<string, number>();
      for (const receipt of receipts) {
        if (!lastCost.has(receipt.stockId)) lastCost.set(receipt.stockId, Number(receipt.unitCost));
      }
      const printers = await tx.printer.findMany({
        where: { tenantId, status: { not: 'RETIRED' } },
        select: { siteId: true, modelId: true },
      });

      const now = new Date();
      return rows.map((row) => {
        const info = index.get(referenceKey(row.reference));
        const unitCost = lastCost.get(row.id) ?? info?.unitPrice ?? null;
        const engineRate = rates?.get(`${row.siteId}|${referenceKey(row.reference)}`) ?? null;
        return {
          id: row.id,
          site: row.site,
          reference: row.reference,
          channel: row.channel,
          models: info?.models.map((model) => model.name) ?? [],
          printers: info
            ? printers.filter((p) => p.siteId === row.siteId && info.modelIds.has(p.modelId)).length
            : 0,
          quantity: row.quantity,
          minQuantity: row.minQuantity,
          leadTimeDays: row.leadTimeDays,
          level: stockLevel(row.quantity, row.minQuantity),
          unitCost,
          value: unitCost === null ? null : Math.round(unitCost * row.quantity * 100) / 100,
          currency,
          forecast: stockForecast({
            quantity: row.quantity,
            minQuantity: row.minQuantity,
            leadTimeDays: row.leadTimeDays,
            engineRate,
            installations: Math.max(0, installed.get(row.id) ?? 0),
            windowDays: FORECAST_WINDOW_DAYS,
            now,
          }),
          updatedAt: row.updatedAt.toISOString(),
        };
      });
    });
  }

  async list(tenantId: string, query: StockListQuery): Promise<Page<TonerStock>> {
    const rows = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.tonerStock.findMany({
        where: {
          tenantId,
          ...(query.siteId ? { siteId: query.siteId } : {}),
          ...(query.search ? { reference: { contains: query.search, mode: 'insensitive' } } : {}),
        },
        include: stockInclude,
        orderBy: [{ site: { name: 'asc' } }, { reference: 'asc' }],
      }),
    );
    const filtered = query.level
      ? rows.filter((row) => stockLevel(row.quantity, row.minQuantity) === query.level)
      : rows;
    const page = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    return {
      items: await this.describe(tenantId, page),
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(tenantId: string, stockId: string): Promise<TonerStock> {
    const row = await withTenant(this.appPrisma, tenantId, (tx) =>
      this.find(tx, tenantId, stockId),
    );
    const [stock] = await this.describe(tenantId, [row]);
    return stock!;
  }

  async create(
    tenantId: string,
    input: StockCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<TonerStock> {
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const info = (await this.referenceIndex(tx, tenantId)).get(referenceKey(input.reference));
      if (!info) {
        throw new BadRequestException(
          'Référence inconnue : renseignez-la d’abord dans la fiche technique d’un modèle.',
        );
      }
      const site = await tx.site.findFirst({
        where: { id: input.siteId, tenantId },
        select: { name: true },
      });
      if (!site) throw new BadRequestException('Site introuvable dans cette entreprise.');
      const created = await tx.tonerStock.create({
        data: {
          tenantId,
          siteId: input.siteId,
          reference: info.reference,
          channel: info.channel,
          minQuantity: input.minQuantity,
          leadTimeDays: input.leadTimeDays,
        },
        include: stockInclude,
      });
      await this.alerts.evaluateStock(tx, tenantId, created, site.name);
      return created;
    }).catch((error: unknown) => {
      throw isUniqueViolation(error)
        ? new ConflictException('Cette référence est déjà suivie sur ce site.')
        : error;
    });
    await this.record('stock.created', tenantId, row.id, actor, context, {
      reference: row.reference,
      site: row.site.name,
      minQuantity: row.minQuantity,
    });
    return this.get(tenantId, row.id);
  }

  async update(
    tenantId: string,
    stockId: string,
    input: StockUpdateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<TonerStock> {
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      await this.find(tx, tenantId, stockId);
      const updated = await tx.tonerStock.update({
        where: { id: stockId },
        data: input,
        include: stockInclude,
      });
      await this.alerts.evaluateStock(tx, tenantId, updated, updated.site.name);
      return updated;
    });
    await this.record('stock.updated', tenantId, stockId, actor, context, {
      reference: row.reference,
      site: row.site.name,
      ...input,
    });
    return this.get(tenantId, stockId);
  }

  async movements(
    tenantId: string,
    stockId: string,
    query: ListQuery,
  ): Promise<Page<StockMovement>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      await this.find(tx, tenantId, stockId);
      const where = { tenantId, stockId };
      const total = await tx.stockMovement.count({ where });
      const rows = await tx.stockMovement.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { replacement: { select: { printer: { select: { id: true, name: true } } } } },
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
          replacementId: row.replacementId,
          printer: row.replacement?.printer ?? null,
          occurredAt: row.occurredAt.toISOString(),
          createdByEmail: row.createdByEmail,
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  /** Réception, sortie ou inventaire : un mouvement du registre, jamais une réécriture du stock. */
  async createMovement(
    tenantId: string,
    stockId: string,
    input: StockMovementCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<TonerStock> {
    const movement = await withTenant(this.appPrisma, tenantId, async (tx) => {
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
      const created = await tx.stockMovement.create({
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
      await this.alerts.evaluateStock(tx, tenantId, after, after.site.name);
      return { created, stock };
    }).catch((error: unknown) => {
      throw insufficientStock(error) ?? error;
    });
    await this.record('stock.movement_created', tenantId, stockId, actor, context, {
      reference: movement.stock.reference,
      site: movement.stock.site.name,
      type: input.type,
      quantity: movement.created.quantity,
      balanceAfter: movement.created.balanceAfter,
    });
    return this.get(tenantId, stockId);
  }

  /** Transfert entre deux sites : deux mouvements liés, et l'article créé au besoin à l'arrivée. */
  async transfer(
    tenantId: string,
    input: StockTransferInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<{ from: TonerStock; to: TonerStock }> {
    const result = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const from = await this.find(tx, tenantId, input.fromStockId);
      if (from.siteId === input.toSiteId) {
        throw new BadRequestException('Choisissez un autre site que celui de départ.');
      }
      const site = await tx.site.findFirst({
        where: { id: input.toSiteId, tenantId },
        select: { id: true, name: true },
      });
      if (!site) throw new BadRequestException('Site introuvable dans cette entreprise.');
      const to =
        (await tx.tonerStock.findFirst({
          where: { tenantId, siteId: site.id, reference: from.reference },
          include: stockInclude,
        })) ??
        (await tx.tonerStock.create({
          data: { tenantId, siteId: site.id, reference: from.reference, channel: from.channel },
          include: stockInclude,
        }));
      const transferId = randomUUID();
      const common = {
        tenantId,
        transferId,
        notes: input.notes,
        createdById: actor.userId,
        createdByEmail: actor.email,
      };
      await tx.stockMovement.create({
        data: { ...common, stockId: from.id, type: 'TRANSFER_OUT', quantity: -input.quantity },
      });
      await tx.stockMovement.create({
        data: { ...common, stockId: to.id, type: 'TRANSFER_IN', quantity: input.quantity },
      });
      for (const id of [from.id, to.id]) {
        const after = await this.find(tx, tenantId, id);
        await this.alerts.evaluateStock(tx, tenantId, after, after.site.name);
      }
      return { from, to, transferId };
    }).catch((error: unknown) => {
      throw insufficientStock(error) ?? error;
    });
    await this.record('stock.transferred', tenantId, result.from.id, actor, context, {
      reference: result.from.reference,
      from: result.from.site.name,
      to: result.to.site.name,
      quantity: input.quantity,
      transferId: result.transferId,
    });
    return {
      from: await this.get(tenantId, result.from.id),
      to: await this.get(tenantId, result.to.id),
    };
  }

  /**
   * Alertes de rupture prévue : un article dont la couverture est plus courte que son délai de
   * réapprovisionnement. Évaluée périodiquement, car la prévision dépend du moteur CMJN.
   */
  async evaluateForecastAlerts(tenantId: string): Promise<number> {
    const rows = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.tonerStock.findMany({ where: { tenantId }, include: stockInclude }),
    );
    const stocks = await this.describe(tenantId, rows);
    let raised = 0;
    await withTenant(this.appPrisma, tenantId, async (tx) => {
      for (const stock of stocks) {
        const key = `stock-forecast:${stock.id}`;
        const { daysOfCover, stockoutAt } = stock.forecast;
        if (
          stock.quantity > 0 &&
          daysOfCover !== null &&
          stockoutAt !== null &&
          daysOfCover < stock.leadTimeDays
        ) {
          raised++;
          await this.alerts.raise(tx, tenantId, {
            type: 'STOCK_FORECAST',
            severity: 'WARNING',
            dedupeKey: key,
            title: `Rupture prévue de ${stock.reference} à ${stock.site.name}`,
            message: `Au rythme actuel, le stock tient ${Math.floor(daysOfCover)} jour(s), moins que le délai de réapprovisionnement de ${stock.leadTimeDays} jours. Commande conseillée : ${stock.forecast.recommendedOrder}.`,
            stockId: stock.id,
            siteId: stock.site.id,
          });
        } else {
          await this.alerts.resolve(tx, tenantId, [key]);
        }
      }
    });
    return raised;
  }

  async find(tx: TransactionClient, tenantId: string, stockId: string): Promise<StockRow> {
    const stock = await tx.tonerStock.findFirst({
      where: { id: stockId, tenantId },
      include: stockInclude,
    });
    if (!stock) throw new NotFoundException('Article de stock introuvable.');
    return stock;
  }

  private async record(
    action: string,
    tenantId: string,
    stockId: string,
    actor: Principal,
    context: RequestContext,
    metadata: Record<string, unknown>,
  ) {
    await this.audit.record({
      action,
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'toner_stock',
      targetId: stockId,
      metadata,
      ...context,
    });
  }
}
