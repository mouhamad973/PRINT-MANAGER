import { Prisma, withTenant, type PrismaClient, type TransactionClient } from '@arksen/database';
import {
  CMYK_CHANNELS,
  channelsFor,
  type CalibrationProfile,
  type ChannelConsumption,
  type CmykChannel,
  type ColorMode,
  type ConsumptionMeasurement,
  type ConsumptionSimulation,
  type ConsumptionTotals,
  type FleetConsumption,
  type PagesCount,
  type PrinterConsumption,
  type PrinterConsumptionDetail,
  type TonerSpec,
} from '@arksen/shared-types';
import type {
  CalibrationProfileInput,
  ConsumptionQuery,
  MeasurementCreateInput,
  SimulationInput,
  TonerSpecInput,
} from '@arksen/validation';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Principal, RequestContext } from '../auth/principal.js';
import { PRISMA_APP, PRISMA_SYSTEM } from '../database/database.module.js';
import {
  DAY_MS,
  dailyVolumes,
  periodTotals,
  toIntervals,
  type Reading,
} from '../meters/meter-analysis.js';
import { loadReadings, startOfDay } from '../meters/meters.service.js';
import { EngineClient, type EngineItem, type EngineItemResult } from './engine.client.js';

const DEFAULT_COVERAGE = 5;

const toNumber = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value);

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

type TonerRow = Prisma.TonerModelGetPayload<object>;
type ProfileRow = Prisma.CalibrationProfileGetPayload<object>;
type MeasurementRow = Prisma.ConsumptionMeasurementGetPayload<object>;

const PROFILE_COLUMNS = {
  CYAN: { coverage: 'coverageCyan', coefficient: 'coefficientCyan' },
  MAGENTA: { coverage: 'coverageMagenta', coefficient: 'coefficientMagenta' },
  YELLOW: { coverage: 'coverageYellow', coefficient: 'coefficientYellow' },
  BLACK: { coverage: 'coverageBlack', coefficient: 'coefficientBlack' },
} as const satisfies Record<
  CmykChannel,
  { coverage: keyof ProfileRow; coefficient: keyof ProfileRow }
>;

function toToner(row: TonerRow, unitPrice: number | null): TonerSpec {
  return {
    id: row.id,
    printerModelId: row.printerModelId,
    tenantId: row.tenantId,
    channel: row.channel,
    reference: row.reference,
    capacityGrams: Number(row.capacityGrams),
    yieldPages: row.yieldPages,
    referenceCoverage: Number(row.referenceCoverage),
    unitPrice,
  };
}

function toProfile(printerId: string, row: ProfileRow | null): CalibrationProfile {
  const coverage = {} as Record<CmykChannel, number>;
  const manualCoefficients = {} as Record<CmykChannel, number | null>;
  for (const channel of CMYK_CHANNELS) {
    const columns = PROFILE_COLUMNS[channel];
    coverage[channel] = row ? Number(row[columns.coverage]) : DEFAULT_COVERAGE;
    manualCoefficients[channel] = row
      ? toNumber(row[columns.coefficient] as Prisma.Decimal | null)
      : null;
  }
  return {
    printerId,
    coverage,
    paperFormat: row?.paperFormat ?? 'A4',
    mediaFactor: row ? Number(row.mediaFactor) : 1,
    manualCoefficients,
    isDefault: row === null,
  };
}

function sortChannels<T extends { channel: CmykChannel }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => CMYK_CHANNELS.indexOf(a.channel) - CMYK_CHANNELS.indexOf(b.channel),
  );
}

export interface PrinterContext {
  id: string;
  name: string;
  siteName: string;
  modelId: string;
  colorMode: ColorMode;
}

/** Tout ce dont le moteur a besoin pour un ensemble de machines, chargé en une fois. */
interface EngineContext {
  toners: Map<string, TonerSpec[]>;
  profiles: Map<string, CalibrationProfile>;
  measurements: Map<string, MeasurementRow[]>;
  readings: Map<string, Reading[]>;
}

/** Pages d'une machine entre deux jours inclus, d'après ses relevés de compteurs. */
function pagesBetween(readings: Reading[] | undefined, from: string, to: string): PagesCount {
  const totals = periodTotals(
    dailyVolumes(toIntervals(readings ?? []), startOfDay(from), startOfDay(to)),
  );
  return { total: totals.total, color: totals.color, coverage: totals.coverage };
}

function measurementDays(row: MeasurementRow): { from: string; to: string } {
  return { from: isoDay(row.periodStart), to: isoDay(new Date(row.periodEnd.getTime() - DAY_MS)) };
}

/** Toners complets d'une machine : un par canal de son mode d'impression, sinon rien. */
function completeToners(context: EngineContext, printer: PrinterContext): TonerSpec[] | null {
  const toners = context.toners.get(printer.modelId) ?? [];
  const needed = channelsFor(printer.colorMode);
  const found = needed.map((channel) => toners.find((toner) => toner.channel === channel));
  return found.every(Boolean) ? (found as TonerSpec[]) : null;
}

function engineItem(
  context: EngineContext,
  printer: PrinterContext,
  pages: { total: number; color: number },
  overrides: {
    coverage?: Record<CmykChannel, number>;
    paperFormat?: 'A4' | 'A3' | 'SRA3';
    mediaFactor?: number;
  } = {},
  withMeasurements = true,
): EngineItem | null {
  const toners = completeToners(context, printer);
  if (!toners) return null;
  const profile = context.profiles.get(printer.id) ?? toProfile(printer.id, null);
  const coverage = overrides.coverage ?? profile.coverage;
  return {
    key: printer.id,
    group: printer.modelId,
    total_pages: pages.total,
    color_pages: printer.colorMode === 'COLOR' ? pages.color : 0,
    paper_format: overrides.paperFormat ?? profile.paperFormat,
    media_factor: overrides.mediaFactor ?? profile.mediaFactor,
    channels: toners.map((toner) => ({
      channel: toner.channel,
      capacity_g: toner.capacityGrams,
      yield_pages: toner.yieldPages,
      reference_coverage: toner.referenceCoverage,
      coverage: coverage[toner.channel],
      unit_price: toner.unitPrice,
      manual_coefficient: profile.manualCoefficients[toner.channel],
    })),
    measurements: withMeasurements
      ? (context.measurements.get(printer.id) ?? [])
          .filter((row) => toners.some((toner) => toner.channel === row.channel))
          .map((row) => {
            const days = measurementDays(row);
            const counted = pagesBetween(context.readings.get(printer.id), days.from, days.to);
            return {
              id: row.id,
              channel: row.channel,
              total_pages: counted.total,
              color_pages: printer.colorMode === 'COLOR' ? counted.color : 0,
              real_g: Number(row.grams),
            };
          })
      : [],
  };
}

function toChannels(result: EngineItemResult): ChannelConsumption[] {
  return sortChannels(
    result.channels.map((channel) => ({
      channel: channel.channel,
      relevantPages: channel.relevant_pages,
      coverage: channel.coverage,
      referenceGramsPerPage: channel.reference_g_per_page,
      theoreticalGrams: channel.theoretical_g,
      estimatedGrams: channel.estimated_g,
      estimatedGramsPer1000Pages: channel.estimated_g_per_1000_pages,
      calibration: channel.calibration,
      costTheoretical: channel.cost_theoretical,
      costEstimated: channel.cost_estimated,
    })),
  );
}

function toTotals(result: EngineItemResult): ConsumptionTotals {
  return {
    theoreticalGrams: result.totals.theoretical_g,
    estimatedGrams: result.totals.estimated_g,
    costTheoretical: result.totals.cost_theoretical,
    costEstimated: result.totals.cost_estimated,
    costPerPage: result.totals.cost_per_page,
    completeCost: result.totals.complete_cost,
  };
}

/**
 * Consommation toner. Le service rassemble les données de l'entreprise (toners, prix, profils,
 * mesures, pages tirées des compteurs) et confie tous les calculs au moteur CMJN.
 */
@Injectable()
export class ConsumptionService {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    @Inject(PRISMA_SYSTEM) private readonly systemPrisma: PrismaClient,
    private readonly engine: EngineClient,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Toners des fiches techniques
  // ---------------------------------------------------------------------------

  /** Toners d'un modèle visible par l'entreprise, avec ses prix d'achat. */
  listToners(tenantId: string, modelId: string): Promise<TonerSpec[]> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const model = await tx.printerModel.findFirst({
        where: { id: modelId, OR: [{ tenantId: null }, { tenantId }] },
        select: { id: true },
      });
      if (!model) throw new NotFoundException('Fiche technique introuvable.');
      const toners = await tx.tonerModel.findMany({ where: { printerModelId: modelId } });
      const prices = await tx.tonerPrice.findMany({
        where: { tenantId, tonerModelId: { in: toners.map((toner) => toner.id) } },
      });
      const byToner = new Map(prices.map((price) => [price.tonerModelId, Number(price.unitPrice)]));
      return sortChannels(toners.map((toner) => toToner(toner, byToner.get(toner.id) ?? null)));
    });
  }

  async listCatalogToners(modelId: string): Promise<TonerSpec[]> {
    const model = await this.systemPrisma.printerModel.findFirst({
      where: { id: modelId, tenantId: null },
    });
    if (!model) throw new NotFoundException('Fiche du catalogue introuvable.');
    const toners = await this.systemPrisma.tonerModel.findMany({
      where: { printerModelId: modelId },
    });
    return sortChannels(toners.map((toner) => toToner(toner, null)));
  }

  /** Crée ou remplace le toner d'un canal. `tenantId` nul : fiche du catalogue Arksen. */
  async saveToner(
    tenantId: string | null,
    modelId: string,
    channel: CmykChannel,
    input: TonerSpecInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<TonerSpec> {
    const write = async (db: TransactionClient | PrismaClient) => {
      const model = await db.printerModel.findFirst({ where: { id: modelId, tenantId } });
      if (!model) throw new NotFoundException('Fiche technique introuvable ou non modifiable.');
      if (!channelsFor(model.colorMode).includes(channel)) {
        throw new BadRequestException(
          'Ce modèle imprime en noir et blanc : il n’a qu’un toner noir.',
        );
      }
      return db.tonerModel.upsert({
        where: { printerModelId_channel: { printerModelId: modelId, channel } },
        create: { ...input, printerModelId: modelId, channel, tenantId },
        update: input,
      });
    };
    const row = tenantId
      ? await withTenant(this.appPrisma, tenantId, write)
      : await write(this.systemPrisma);
    await this.audit.record({
      action: 'toner.saved',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'printer_model',
      targetId: modelId,
      metadata: {
        channel,
        reference: input.reference,
        capacityGrams: input.capacityGrams,
        yieldPages: input.yieldPages,
      },
      ...context,
    });
    return toToner(row, null);
  }

  async deleteToner(
    tenantId: string | null,
    modelId: string,
    channel: CmykChannel,
    actor: Principal,
    context: RequestContext,
  ): Promise<void> {
    const remove = async (db: TransactionClient | PrismaClient) => {
      const deleted = await db.tonerModel.deleteMany({
        where: { printerModelId: modelId, channel, tenantId },
      });
      if (deleted.count === 0) throw new NotFoundException('Toner introuvable ou non modifiable.');
    };
    if (tenantId) await withTenant(this.appPrisma, tenantId, remove);
    else await remove(this.systemPrisma);
    await this.audit.record({
      action: 'toner.deleted',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'printer_model',
      targetId: modelId,
      metadata: { channel },
      ...context,
    });
  }

  /** Prix d'achat d'une cartouche pour l'entreprise ; `null` le retire. */
  async setPrice(
    tenantId: string,
    tonerId: string,
    unitPrice: number | null,
    actor: Principal,
    context: RequestContext,
  ): Promise<void> {
    const toner = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const found = await tx.tonerModel.findFirst({
        where: { id: tonerId, OR: [{ tenantId: null }, { tenantId }] },
      });
      if (!found) throw new NotFoundException('Toner introuvable.');
      if (unitPrice === null) {
        await tx.tonerPrice.deleteMany({ where: { tenantId, tonerModelId: tonerId } });
      } else {
        await tx.tonerPrice.upsert({
          where: { tenantId_tonerModelId: { tenantId, tonerModelId: tonerId } },
          create: { tenantId, tonerModelId: tonerId, unitPrice },
          update: { unitPrice },
        });
      }
      return found;
    });
    await this.audit.record({
      action: 'toner.price_set',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'toner',
      targetId: tonerId,
      metadata: { reference: toner.reference, channel: toner.channel, unitPrice },
      ...context,
    });
  }

  // ---------------------------------------------------------------------------
  // Profil de calibration et mesures réelles
  // ---------------------------------------------------------------------------

  async saveProfile(
    tenantId: string,
    printerId: string,
    input: CalibrationProfileInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<CalibrationProfile> {
    const data = {
      coverageCyan: input.coverage.CYAN,
      coverageMagenta: input.coverage.MAGENTA,
      coverageYellow: input.coverage.YELLOW,
      coverageBlack: input.coverage.BLACK,
      paperFormat: input.paperFormat,
      mediaFactor: input.mediaFactor,
      coefficientCyan: input.manualCoefficients.CYAN,
      coefficientMagenta: input.manualCoefficients.MAGENTA,
      coefficientYellow: input.manualCoefficients.YELLOW,
      coefficientBlack: input.manualCoefficients.BLACK,
    };
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      await this.findPrinter(tx, tenantId, printerId);
      return tx.calibrationProfile.upsert({
        where: { printerId },
        create: { ...data, printerId, tenantId },
        update: data,
      });
    });
    await this.audit.record({
      action: 'consumption.calibration_updated',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'printer',
      targetId: printerId,
      metadata: { ...input },
      ...context,
    });
    return toProfile(printerId, row);
  }

  async createMeasurement(
    tenantId: string,
    printerId: string,
    input: MeasurementCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<{ id: string }> {
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const printer = await this.findPrinter(tx, tenantId, printerId);
      if (!channelsFor(printer.model.colorMode).includes(input.channel)) {
        throw new BadRequestException(
          'Cette machine imprime en noir et blanc : seul le noir se mesure.',
        );
      }
      let grams = input.grams;
      if (input.method === 'CARTRIDGES') {
        const toner = await tx.tonerModel.findFirst({
          where: { printerModelId: printer.model.id, channel: input.channel },
        });
        if (!toner) {
          throw new BadRequestException(
            'Renseignez d’abord le toner de ce canal dans la fiche technique : sa masse convertit les cartouches en grammes.',
          );
        }
        grams = Number(toner.capacityGrams) * input.cartridges!;
      }
      const periodStart = startOfDay(input.from);
      const periodEnd = new Date(startOfDay(input.to).getTime() + DAY_MS);
      if (periodEnd.getTime() > Date.now() + DAY_MS) {
        throw new BadRequestException(
          'Une consommation réelle ne peut pas porter sur une période future.',
        );
      }
      return tx.consumptionMeasurement.create({
        data: {
          tenantId,
          printerId,
          channel: input.channel,
          periodStart,
          periodEnd,
          method: input.method,
          grams: grams!,
          cartridges: input.cartridges,
          notes: input.notes,
          createdById: actor.userId,
          createdByEmail: actor.email,
        },
      });
    });
    await this.audit.record({
      action: 'consumption.measurement_created',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'printer',
      targetId: printerId,
      metadata: {
        channel: row.channel,
        method: row.method,
        grams: Number(row.grams),
        from: input.from,
        to: input.to,
      },
      ...context,
    });
    return { id: row.id };
  }

  async deleteMeasurement(
    tenantId: string,
    printerId: string,
    measurementId: string,
    actor: Principal,
    context: RequestContext,
  ): Promise<void> {
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const found = await tx.consumptionMeasurement.findFirst({
        where: { id: measurementId, printerId, tenantId },
      });
      if (!found) throw new NotFoundException('Mesure introuvable.');
      await tx.consumptionMeasurement.delete({ where: { id: measurementId } });
      return found;
    });
    await this.audit.record({
      action: 'consumption.measurement_deleted',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'printer',
      targetId: printerId,
      metadata: { channel: row.channel, grams: Number(row.grams), method: row.method },
      ...context,
    });
  }

  // ---------------------------------------------------------------------------
  // Consommation
  // ---------------------------------------------------------------------------

  async printerConsumption(
    tenantId: string,
    printerId: string,
    query: ConsumptionQuery,
  ): Promise<PrinterConsumptionDetail> {
    const { currency, printers, context } = await this.load(tenantId, [printerId], query);
    const printer = printers.find((item) => item.id === printerId);
    if (!printer) throw new NotFoundException('Machine introuvable.');
    const results = await this.engine.estimate(this.items(printers, context, query, [printerId]));
    const result = results.get(printerId);
    const toners = context.toners.get(printer.modelId) ?? [];
    const outcome = this.toPrinterConsumption(printer, context, query, result);

    const byId = new Map(result?.measurements.map((item) => [item.id, item]) ?? []);
    const measurements: ConsumptionMeasurement[] = (context.measurements.get(printerId) ?? [])
      .sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime())
      .map((row) => {
        const days = measurementDays(row);
        const computed = byId.get(row.id);
        return {
          id: row.id,
          printerId,
          channel: row.channel,
          periodStart: row.periodStart.toISOString(),
          periodEnd: row.periodEnd.toISOString(),
          method: row.method,
          grams: Number(row.grams),
          cartridges: toNumber(row.cartridges),
          notes: row.notes,
          createdByEmail: row.createdByEmail,
          createdAt: row.createdAt.toISOString(),
          pages: pagesBetween(context.readings.get(printerId), days.from, days.to),
          theoreticalGrams: computed?.theoretical_g ?? null,
          deviationGrams: computed?.deviation_g ?? null,
          deviationRatio: computed?.deviation_ratio ?? null,
          overconsumptionRatio: computed?.overconsumption_ratio ?? null,
        };
      });

    return {
      ...outcome,
      from: query.from,
      to: query.to,
      currency,
      profile: context.profiles.get(printerId) ?? toProfile(printerId, null),
      toners: sortChannels(toners),
      measurements,
    };
  }

  async fleetConsumption(tenantId: string, query: ConsumptionQuery): Promise<FleetConsumption> {
    const targets = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.printer.findMany({
        where: {
          tenantId,
          status: { not: 'RETIRED' },
          ...(query.siteId ? { siteId: query.siteId } : {}),
          ...(query.colorMode ? { model: { colorMode: query.colorMode } } : {}),
        },
        select: { id: true },
      }),
    );
    const targetIds = targets.map((printer) => printer.id);
    const { currency, printers, context } = await this.load(tenantId, targetIds, query);
    const results = await this.engine.estimate(this.items(printers, context, query, targetIds));

    const perPrinter = printers
      .filter((printer) => targetIds.includes(printer.id))
      .map((printer) =>
        this.toPrinterConsumption(printer, context, query, results.get(printer.id)),
      );

    const channels = CMYK_CHANNELS.map((channel) => {
      const entries = perPrinter.flatMap((printer) =>
        printer.channels.filter((item) => item.channel === channel),
      );
      const costs = entries.map((entry) => entry.costEstimated);
      return {
        channel,
        theoreticalGrams: round(
          entries.reduce((sum, entry) => sum + entry.theoreticalGrams, 0),
          3,
        ),
        estimatedGrams: round(
          entries.reduce((sum, entry) => sum + entry.estimatedGrams, 0),
          3,
        ),
        costEstimated: costs.some((cost) => cost !== null)
          ? round(
              costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0),
              4,
            )
          : null,
      };
    });
    const computed = perPrinter.filter((printer) => printer.totals !== null);
    const pages = computed.reduce((sum, printer) => sum + printer.pages.total, 0);
    const costs = computed.map((printer) => printer.totals!.costEstimated);
    const costEstimated = costs.some((cost) => cost !== null)
      ? round(
          costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0),
          4,
        )
      : null;
    const theoreticalCosts = computed.map((printer) => printer.totals!.costTheoretical);
    return {
      from: query.from,
      to: query.to,
      currency,
      channels,
      totals: {
        pages,
        theoreticalGrams: round(
          computed.reduce((sum, printer) => sum + printer.totals!.theoreticalGrams, 0),
          3,
        ),
        estimatedGrams: round(
          computed.reduce((sum, printer) => sum + printer.totals!.estimatedGrams, 0),
          3,
        ),
        costTheoretical: theoreticalCosts.some((cost) => cost !== null)
          ? round(
              theoreticalCosts.reduce<number>((sum, cost) => sum + (cost ?? 0), 0),
              4,
            )
          : null,
        costEstimated,
        costPerPage: costEstimated !== null && pages > 0 ? round(costEstimated / pages, 6) : null,
        completeCost: computed.every((printer) => printer.totals!.completeCost),
      },
      printers: perPrinter.sort(
        (a, b) =>
          (b.totals?.estimatedGrams ?? -1) - (a.totals?.estimatedGrams ?? -1) ||
          a.name.localeCompare(b.name, 'fr'),
      ),
    };
  }

  /** Consommation d'un travail décrit par son aplat, sur une machine ou un modèle. */
  async simulate(tenantId: string, input: SimulationInput): Promise<ConsumptionSimulation> {
    return (await this.run(tenantId, input)).simulation;
  }

  /**
   * Consommation d'un travail mesuré (fichier PDF) sur une machine. Les pages sont des surfaces
   * A4 ; le facteur de support est celui de la machine.
   */
  async estimateWork(
    tenantId: string,
    printerId: string,
    work: { pages: number; colorPages: number; coverage: Record<CmykChannel, number> },
    useCalibration: boolean,
  ): Promise<{ simulation: ConsumptionSimulation; printer: PrinterContext }> {
    const { simulation, target } = await this.run(tenantId, {
      printerId,
      ...work,
      paperFormat: 'A4',
      useCalibration,
    });
    return { simulation, printer: target };
  }

  private async run(
    tenantId: string,
    input: Omit<SimulationInput, 'mediaFactor'> & { mediaFactor?: number },
  ): Promise<{ simulation: ConsumptionSimulation; target: PrinterContext }> {
    const today = isoDay(new Date());
    const range = { from: today, to: today };
    let currency: string;
    let target: PrinterContext;
    let printers: PrinterContext[];
    let context: EngineContext;

    if (input.printerId) {
      ({ currency, printers, context } = await this.load(tenantId, [input.printerId], range));
      const found = printers.find((printer) => printer.id === input.printerId);
      if (!found) throw new NotFoundException('Machine introuvable.');
      target = found;
    } else {
      const model = await withTenant(this.appPrisma, tenantId, (tx) =>
        tx.printerModel.findFirst({
          where: { id: input.modelId!, OR: [{ tenantId: null }, { tenantId }] },
          select: { id: true, colorMode: true, manufacturer: true, name: true },
        }),
      );
      if (!model) throw new NotFoundException('Fiche technique introuvable.');
      ({ currency, printers, context } = await this.load(tenantId, [], range, model.id));
      target = {
        id: 'simulation',
        name: `${model.manufacturer} ${model.name}`,
        siteName: '',
        modelId: model.id,
        colorMode: model.colorMode,
      };
    }

    const colorPages = target.colorMode === 'COLOR' ? input.colorPages : 0;
    const item = engineItem(
      context,
      target,
      { total: input.pages, color: colorPages },
      { coverage: input.coverage, paperFormat: input.paperFormat, mediaFactor: input.mediaFactor },
      input.useCalibration,
    );
    if (!item) {
      throw new BadRequestException('Les toners de cette fiche technique ne sont pas renseignés.');
    }
    if (!input.useCalibration) {
      item.group = null;
      item.channels = item.channels.map((channel) => ({ ...channel, manual_coefficient: null }));
    }
    // Les autres machines du modèle ne servent qu'à la calibration du modèle.
    const siblings = input.useCalibration
      ? printers
          .filter((printer) => printer.id !== target.id && printer.modelId === target.modelId)
          .map((printer) => engineItem(context, printer, { total: 0, color: 0 }))
          .filter(
            (sibling): sibling is EngineItem => sibling !== null && sibling.measurements.length > 0,
          )
      : [];
    const result = (await this.engine.estimate([item, ...siblings])).get(target.id)!;
    return {
      target,
      simulation: {
        currency,
        pages: input.pages,
        colorPages,
        channels: toChannels(result),
        totals: toTotals(result),
      },
    };
  }

  // ---------------------------------------------------------------------------

  private async findPrinter(tx: TransactionClient, tenantId: string, printerId: string) {
    const printer = await tx.printer.findFirst({
      where: { id: printerId, tenantId },
      select: { id: true, model: { select: { id: true, colorMode: true } } },
    });
    if (!printer) throw new NotFoundException('Machine introuvable.');
    return printer;
  }

  /**
   * Charge les machines visées et celles qui portent des mesures (elles calibrent leur modèle),
   * avec leurs toners, prix, profils, mesures et relevés de compteurs.
   */
  private load(
    tenantId: string,
    targetIds: string[],
    range: { from: string; to: string },
    modelId?: string,
  ): Promise<{ currency: string; printers: PrinterContext[]; context: EngineContext }> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      });
      const rows = await tx.printer.findMany({
        where: {
          tenantId,
          OR: [
            { id: { in: targetIds } },
            { measurements: { some: {} }, ...(modelId ? { modelId } : {}) },
          ],
        },
        select: {
          id: true,
          name: true,
          modelId: true,
          site: { select: { name: true } },
          model: { select: { colorMode: true } },
        },
      });
      const printers: PrinterContext[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        siteName: row.site.name,
        modelId: row.modelId,
        colorMode: row.model.colorMode,
      }));
      const printerIds = printers.map((printer) => printer.id);
      const modelIds = [
        ...new Set([...printers.map((printer) => printer.modelId), ...(modelId ? [modelId] : [])]),
      ];

      const [toners, profiles, measurements] = await Promise.all([
        tx.tonerModel.findMany({ where: { printerModelId: { in: modelIds } } }),
        tx.calibrationProfile.findMany({ where: { printerId: { in: printerIds } } }),
        tx.consumptionMeasurement.findMany({ where: { printerId: { in: printerIds } } }),
      ]);
      const prices = await tx.tonerPrice.findMany({
        where: { tenantId, tonerModelId: { in: toners.map((toner) => toner.id) } },
      });
      const priceOf = new Map(prices.map((price) => [price.tonerModelId, Number(price.unitPrice)]));

      // Les relevés doivent couvrir la période demandée et celles des mesures.
      let earliest = range.from;
      let latest = range.to;
      for (const row of measurements) {
        const days = measurementDays(row);
        if (days.from < earliest) earliest = days.from;
        if (days.to > latest) latest = days.to;
      }
      const readings = await loadReadings(tx, printerIds, earliest, latest);

      const context: EngineContext = {
        toners: new Map(),
        profiles: new Map(profiles.map((row) => [row.printerId, toProfile(row.printerId, row)])),
        measurements: new Map(),
        readings,
      };
      for (const toner of toners) {
        context.toners.set(toner.printerModelId, [
          ...(context.toners.get(toner.printerModelId) ?? []),
          toToner(toner, priceOf.get(toner.id) ?? null),
        ]);
      }
      for (const row of measurements) {
        context.measurements.set(row.printerId, [
          ...(context.measurements.get(row.printerId) ?? []),
          row,
        ]);
      }
      return { currency: tenant.currency, printers, context };
    });
  }

  /** Lots pour le moteur : les machines visées avec leurs pages, les autres pour la calibration seulement. */
  private items(
    printers: PrinterContext[],
    context: EngineContext,
    range: { from: string; to: string },
    targetIds: string[],
  ): EngineItem[] {
    return printers
      .map((printer) => {
        const target = targetIds.includes(printer.id);
        const pages = target
          ? pagesBetween(context.readings.get(printer.id), range.from, range.to)
          : { total: 0, color: 0 };
        return engineItem(context, printer, pages);
      })
      .filter((item): item is EngineItem => item !== null);
  }

  private toPrinterConsumption(
    printer: PrinterContext,
    context: EngineContext,
    range: { from: string; to: string },
    result: EngineItemResult | undefined,
  ): PrinterConsumption {
    const pages = pagesBetween(context.readings.get(printer.id), range.from, range.to);
    const base = {
      printerId: printer.id,
      name: printer.name,
      siteName: printer.siteName,
      colorMode: printer.colorMode,
      pages,
    };
    if (!result) return { ...base, gap: 'NO_TONER_SPECS', channels: [], totals: null };
    if (pages.coverage === 0)
      return { ...base, gap: 'NO_PAGES', channels: toChannels(result), totals: null };
    return { ...base, gap: null, channels: toChannels(result), totals: toTotals(result) };
  }
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
