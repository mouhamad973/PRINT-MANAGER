import { Prisma, withTenant, type PrismaClient, type TransactionClient } from '@arksen/database';
import type {
  Comparison,
  FleetMeterAnomaly,
  FleetVolumes,
  MeterImportResult,
  MeterReading,
  Page,
  PrinterVolume,
  PrinterVolumes,
} from '@arksen/shared-types';
import type {
  MeterImportInput,
  MeterReadingCreateInput,
  MeterReadingListQuery,
  VolumeQuery,
} from '@arksen/validation';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Principal, RequestContext } from '../auth/principal.js';
import { isUniqueViolation } from '../common/changes.js';
import { PRISMA_APP } from '../database/database.module.js';
import {
  DAY_MS,
  THRESHOLDS,
  currentAnomalies,
  dailyVolumes,
  mergeDays,
  periodTotals,
  readingAnomalies,
  toIntervals,
  volumeSeries,
  type Reading,
} from './meter-analysis.js';

/** Tolérance sur l'horloge de l'émetteur : un relevé ne peut pas être daté dans le futur. */
const CLOCK_SKEW_MS = 5 * 60_000;
/** Fenêtre d'analyse des anomalies, et historique chargé pour l'établir. */
const ANOMALY_WINDOW_DAYS = 90;
const ANOMALY_HISTORY_DAYS = 180;
/** Relevés antérieurs chargés pour annoter une page d'historique (médiane des pics). */
const HISTORY_CONTEXT = THRESHOLDS.spikeWindow + 1;

type ReadingRow = Prisma.MeterReadingGetPayload<object>;

interface RawReading {
  id: string;
  printer_id: string;
  read_at: Date;
  black_count: number;
  color_count: number | null;
  is_reset: boolean;
}

function fromRaw(row: RawReading): Reading & { printerId: string } {
  return {
    id: row.id,
    printerId: row.printer_id,
    readAt: row.read_at,
    blackCount: row.black_count,
    colorCount: row.color_count,
    isReset: row.is_reset,
  };
}

function startOfDay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Période de comparaison : la période précédente de même durée, ou la même un an plus tôt. */
export function comparisonPeriod(
  from: string,
  to: string,
  kind: Comparison,
): { from: string; to: string } {
  const start = startOfDay(from);
  const end = startOfDay(to);
  if (kind === 'year') {
    const shift = (date: Date) => {
      const shifted = new Date(date);
      shifted.setUTCFullYear(shifted.getUTCFullYear() - 1);
      return isoDay(shifted);
    };
    return { from: shift(start), to: shift(end) };
  }
  const length = end.getTime() - start.getTime() + DAY_MS;
  return {
    from: isoDay(new Date(start.getTime() - length)),
    to: isoDay(new Date(start.getTime() - DAY_MS)),
  };
}

/**
 * Compteurs : relevés, volumes et anomalies, sous Row-Level Security.
 * Les calculs sont délégués à `meter-analysis`, qui ne connaît pas la base.
 */
@Injectable()
export class MetersService {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  /** Historique d'une machine, du plus récent au plus ancien, chaque relevé annoté de son volume et de ses anomalies. */
  listReadings(
    tenantId: string,
    printerId: string,
    query: MeterReadingListQuery,
  ): Promise<Page<MeterReading>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const printer = await this.findPrinter(tx, tenantId, printerId);
      const where = { tenantId, printerId };
      const [rows, total] = await Promise.all([
        tx.meterReading.findMany({
          where,
          orderBy: { readAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.meterReading.count({ where }),
      ]);
      const oldest = rows.at(-1);
      const context = oldest
        ? await tx.meterReading.findMany({
            where: { ...where, readAt: { lt: oldest.readAt } },
            orderBy: { readAt: 'desc' },
            take: HISTORY_CONTEXT,
          })
        : [];
      const chronological = [...rows, ...context].reverse();
      const intervals = toIntervals(chronological);
      const byReading = new Map(intervals.map((interval) => [interval.readingId, interval]));
      const anomalies = readingAnomalies(intervals, {
        monthlyDutyCycle: printer.model.monthlyDutyCycle,
      });
      return {
        items: rows.map((row) =>
          toReading(row, byReading.get(row.id)?.pages ?? null, anomalies.get(row.id) ?? []),
        ),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async createReading(
    tenantId: string,
    printerId: string,
    input: MeterReadingCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<MeterReading> {
    const readAt = new Date(input.readAt);
    assertNotFuture(readAt);
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const printer = await this.findPrinter(tx, tenantId, printerId);
      const colorCount = checkColor(printer.model.colorMode, input.colorCount);
      return tx.meterReading.create({
        data: {
          tenantId,
          printerId,
          readAt,
          blackCount: input.blackCount,
          colorCount,
          totalCount: input.blackCount + (colorCount ?? 0),
          isReset: input.isReset,
          notes: input.notes,
          externalId: input.externalId,
          source: 'MANUAL',
          createdById: actor.userId,
          createdByEmail: actor.email,
        },
      });
    }).catch((error: unknown) => {
      throw isUniqueViolation(error)
        ? new ConflictException('Un relevé existe déjà à cette date pour cette machine.')
        : error;
    });
    await this.audit.record({
      action: 'meter.reading_created',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'printer',
      targetId: printerId,
      metadata: {
        readAt: row.readAt.toISOString(),
        blackCount: row.blackCount,
        colorCount: row.colorCount,
        isReset: row.isReset,
      },
      ...context,
    });
    return toReading(row, null, []);
  }

  async deleteReading(
    tenantId: string,
    printerId: string,
    readingId: string,
    actor: Principal,
    context: RequestContext,
  ): Promise<void> {
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const current = await tx.meterReading.findFirst({
        where: { id: readingId, printerId, tenantId },
      });
      if (!current) {
        throw new NotFoundException('Relevé introuvable.');
      }
      await tx.meterReading.delete({ where: { id: readingId } });
      return current;
    });
    await this.audit.record({
      action: 'meter.reading_deleted',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'printer',
      targetId: printerId,
      metadata: {
        readAt: row.readAt.toISOString(),
        blackCount: row.blackCount,
        colorCount: row.colorCount,
        source: row.source,
      },
      ...context,
    });
  }

  /**
   * Import de relevés repérés par numéro de série. Idempotent : un relevé déjà présent
   * (même machine, même instant) est compté comme doublon et ignoré, l'import peut être rejoué.
   */
  async importReadings(
    tenantId: string,
    input: MeterImportInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<MeterImportResult> {
    const result = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const serials = [...new Set(input.rows.map((row) => row.serialNumber.toUpperCase()))];
      const printers = await tx.printer.findMany({
        where: { tenantId, serialNumber: { in: serials, mode: 'insensitive' } },
        select: { id: true, serialNumber: true, model: { select: { colorMode: true } } },
      });
      const bySerial = new Map(
        printers.map((printer) => [printer.serialNumber.toUpperCase(), printer]),
      );
      const errors: MeterImportResult['errors'] = [];
      const data: Prisma.MeterReadingCreateManyInput[] = [];
      const seen = new Set<string>();
      let duplicates = 0;

      input.rows.forEach((row, index) => {
        const line = index + 1;
        const printer = bySerial.get(row.serialNumber.toUpperCase());
        if (!printer) {
          errors.push({
            row: line,
            message: `Aucune machine ne porte le numéro de série ${row.serialNumber}.`,
          });
          return;
        }
        const readAt = new Date(row.readAt);
        if (readAt.getTime() > Date.now() + CLOCK_SKEW_MS) {
          errors.push({ row: line, message: 'Relevé daté dans le futur.' });
          return;
        }
        let colorCount: number | null;
        try {
          colorCount = checkColor(printer.model.colorMode, row.colorCount);
        } catch (error) {
          errors.push({ row: line, message: (error as Error).message });
          return;
        }
        const key = `${printer.id}|${readAt.getTime()}`;
        if (seen.has(key)) {
          duplicates++;
          return;
        }
        seen.add(key);
        data.push({
          tenantId,
          printerId: printer.id,
          readAt,
          blackCount: row.blackCount,
          colorCount,
          totalCount: row.blackCount + (colorCount ?? 0),
          isReset: row.isReset,
          source: 'IMPORT',
          createdById: actor.userId,
          createdByEmail: actor.email,
        });
      });

      const created = data.length
        ? (await tx.meterReading.createMany({ data, skipDuplicates: true })).count
        : 0;
      return { created, duplicates: duplicates + (data.length - created), errors };
    });
    await this.audit.record({
      action: 'meter.readings_imported',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      metadata: {
        rows: input.rows.length,
        created: result.created,
        duplicates: result.duplicates,
        errors: result.errors.length,
      },
      ...context,
    });
    return result;
  }

  async printerVolumes(
    tenantId: string,
    printerId: string,
    query: VolumeQuery,
  ): Promise<PrinterVolumes> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      await this.findPrinter(tx, tenantId, printerId);
      const readings = await loadReadings(tx, [printerId], query.from, query.to);
      const days = dailyVolumes(
        toIntervals(readings.get(printerId) ?? []),
        startOfDay(query.from),
        startOfDay(query.to),
      );
      const { series, totals } = volumeSeries(days, query.granularity);
      return { from: query.from, to: query.to, granularity: query.granularity, totals, series };
    });
  }

  /** Volumes du parc sur la période, comparés à la période de référence, et détail par machine. */
  async fleetVolumes(tenantId: string, query: VolumeQuery): Promise<FleetVolumes> {
    const comparison = comparisonPeriod(query.from, query.to, query.compare);
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const printers = await tx.printer.findMany({
        where: {
          tenantId,
          ...(query.siteId ? { siteId: query.siteId } : {}),
          ...(query.colorMode ? { model: { colorMode: query.colorMode } } : {}),
        },
        select: {
          id: true,
          name: true,
          status: true,
          site: { select: { name: true } },
          model: { select: { colorMode: true } },
        },
        orderBy: { name: 'asc' },
      });
      const ids = printers.map((printer) => printer.id);
      const earliest = comparison.from < query.from ? comparison.from : query.from;
      const latest = comparison.to > query.to ? comparison.to : query.to;
      const [readings, lastReadings] = await Promise.all([
        loadReadings(tx, ids, earliest, latest),
        latestReadings(tx, ids),
      ]);

      const fleetCurrent = new Map();
      const fleetPrevious = new Map();
      const byPrinter: PrinterVolume[] = [];
      for (const printer of printers) {
        const intervals = toIntervals(readings.get(printer.id) ?? []);
        const current = dailyVolumes(intervals, startOfDay(query.from), startOfDay(query.to));
        const previous = dailyVolumes(
          intervals,
          startOfDay(comparison.from),
          startOfDay(comparison.to),
        );
        mergeDays(fleetCurrent, current);
        mergeDays(fleetPrevious, previous);
        const currentTotals = periodTotals(current);
        const previousTotals = periodTotals(previous);
        // Une machine retirée sans aucun volume sur les deux périodes n'encombre pas le détail.
        if (printer.status === 'RETIRED' && currentTotals.total === 0 && previousTotals.total === 0)
          continue;
        byPrinter.push({
          printerId: printer.id,
          name: printer.name,
          siteName: printer.site.name,
          colorMode: printer.model.colorMode,
          status: printer.status,
          lastReadingAt: lastReadings.get(printer.id)?.readAt.toISOString() ?? null,
          current: currentTotals,
          previous: previousTotals,
        });
      }

      const { series, totals } = volumeSeries(
        printers.length
          ? fleetCurrent
          : dailyVolumes([], startOfDay(query.from), startOfDay(query.to)),
        query.granularity,
      );
      return {
        from: query.from,
        to: query.to,
        granularity: query.granularity,
        comparison: { kind: query.compare, ...comparison },
        totals,
        previousTotals: periodTotals(fleetPrevious),
        series,
        byPrinter: byPrinter.sort(
          (a, b) => b.current.total - a.current.total || a.name.localeCompare(b.name, 'fr'),
        ),
      };
    });
  }

  /**
   * Anomalies du parc : celles révélées par les relevés des 90 derniers jours, et, pour les
   * machines en service, les relevés manquants et l'absence d'activité.
   */
  anomalies(
    tenantId: string,
    filters: { siteId?: string; printerId?: string },
    now = new Date(),
  ): Promise<FleetMeterAnomaly[]> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const printers = await tx.printer.findMany({
        where: {
          tenantId,
          status: { not: 'RETIRED' },
          ...(filters.siteId ? { siteId: filters.siteId } : {}),
          ...(filters.printerId ? { id: filters.printerId } : {}),
        },
        select: {
          id: true,
          name: true,
          status: true,
          site: { select: { name: true } },
          model: { select: { monthlyDutyCycle: true } },
        },
      });
      const ids = printers.map((printer) => printer.id);
      const since = new Date(now.getTime() - ANOMALY_HISTORY_DAYS * DAY_MS);
      const windowStart = now.getTime() - ANOMALY_WINDOW_DAYS * DAY_MS;
      const [readings, lastReadings] = await Promise.all([
        loadReadings(tx, ids, isoDay(since), isoDay(now)),
        latestReadings(tx, ids),
      ]);

      const result: FleetMeterAnomaly[] = [];
      for (const printer of printers) {
        const history = readings.get(printer.id) ?? [];
        const intervals = toIntervals(history);
        const found = [
          ...readingAnomalies(intervals, {
            monthlyDutyCycle: printer.model.monthlyDutyCycle,
          }).values(),
        ]
          .flat()
          .filter((item) => Date.parse(item.detectedAt) >= windowStart);
        if (printer.status === 'ACTIVE') {
          const last = lastReadings.get(printer.id);
          found.push(
            ...currentAnomalies(history.length ? history : last ? [last] : [], intervals, now),
          );
        }
        for (const item of found) {
          result.push({
            ...item,
            printerId: printer.id,
            printerName: printer.name,
            siteName: printer.site.name,
          });
        }
      }
      const rank = { danger: 0, warning: 1, info: 2 } as const;
      return result.sort(
        (a, b) => rank[a.severity] - rank[b.severity] || b.detectedAt.localeCompare(a.detectedAt),
      );
    });
  }

  private async findPrinter(tx: TransactionClient, tenantId: string, printerId: string) {
    const printer = await tx.printer.findFirst({
      where: { id: printerId, tenantId },
      select: { id: true, model: { select: { colorMode: true, monthlyDutyCycle: true } } },
    });
    if (!printer) {
      throw new NotFoundException('Machine introuvable.');
    }
    return printer;
  }
}

function toReading(
  row: ReadingRow,
  delta: MeterReading['delta'],
  anomalies: MeterReading['anomalies'],
): MeterReading {
  return {
    id: row.id,
    printerId: row.printerId,
    readAt: row.readAt.toISOString(),
    blackCount: row.blackCount,
    colorCount: row.colorCount,
    totalCount: row.totalCount,
    isReset: row.isReset,
    source: row.source,
    notes: row.notes,
    createdByEmail: row.createdByEmail,
    createdAt: row.createdAt.toISOString(),
    delta,
    anomalies,
  };
}

function assertNotFuture(readAt: Date): void {
  if (readAt.getTime() > Date.now() + CLOCK_SKEW_MS) {
    throw new BadRequestException('Un relevé ne peut pas être daté dans le futur.');
  }
}

/** Le compteur couleur est exigé d'une machine couleur, et refusé d'une machine noir et blanc. */
function checkColor(
  colorMode: 'COLOR' | 'MONOCHROME',
  colorCount: number | null | undefined,
): number | null {
  if (colorMode === 'COLOR') {
    if (colorCount === null || colorCount === undefined) {
      throw new BadRequestException(
        'Saisissez le compteur couleur : la machine imprime en couleur.',
      );
    }
    return colorCount;
  }
  if (colorCount) {
    throw new BadRequestException(
      'Cette machine imprime en noir et blanc : elle n’a pas de compteur couleur.',
    );
  }
  return null;
}

/**
 * Relevés utiles au calcul des volumes de `[from, to]` : ceux de la période, plus, pour chaque
 * machine, le dernier avant et le premier après, qui encadrent ses bords. Triés par date.
 */
async function loadReadings(
  tx: TransactionClient,
  printerIds: string[],
  from: string,
  to: string,
): Promise<Map<string, Reading[]>> {
  const result = new Map<string, Reading[]>();
  if (printerIds.length === 0) return result;
  const start = startOfDay(from);
  const end = new Date(startOfDay(to).getTime() + DAY_MS);
  const rows = await tx.$queryRaw<RawReading[]>`
    SELECT id, printer_id, read_at, black_count, color_count, is_reset FROM (
      (SELECT id, printer_id, read_at, black_count, color_count, is_reset
         FROM meter_readings
        WHERE printer_id = ANY(${printerIds}::uuid[]) AND read_at >= ${start} AND read_at <= ${end})
      UNION
      (SELECT DISTINCT ON (printer_id) id, printer_id, read_at, black_count, color_count, is_reset
         FROM meter_readings
        WHERE printer_id = ANY(${printerIds}::uuid[]) AND read_at < ${start}
        ORDER BY printer_id, read_at DESC)
      UNION
      (SELECT DISTINCT ON (printer_id) id, printer_id, read_at, black_count, color_count, is_reset
         FROM meter_readings
        WHERE printer_id = ANY(${printerIds}::uuid[]) AND read_at > ${end}
        ORDER BY printer_id, read_at ASC)
    ) AS readings
    ORDER BY printer_id, read_at`;
  for (const row of rows) {
    const reading = fromRaw(row);
    result.set(reading.printerId, [...(result.get(reading.printerId) ?? []), reading]);
  }
  return result;
}

/** Dernier relevé de chaque machine, quelle que soit sa date. */
async function latestReadings(
  tx: TransactionClient,
  printerIds: string[],
): Promise<Map<string, Reading>> {
  if (printerIds.length === 0) return new Map();
  const rows = await tx.$queryRaw<RawReading[]>`
    SELECT DISTINCT ON (printer_id) id, printer_id, read_at, black_count, color_count, is_reset
      FROM meter_readings
     WHERE printer_id = ANY(${printerIds}::uuid[])
     ORDER BY printer_id, read_at DESC`;
  return new Map(rows.map((row) => [row.printer_id, fromRaw(row)]));
}
