import { createHash } from 'node:crypto';
import { Prisma, withTenant, type PrismaClient } from '@arksen/database';
import type {
  CmykChannel,
  Page,
  PrintJob,
  PrintJobEstimate,
  PrintJobPage,
  PrintJobSummary,
} from '@arksen/shared-types';
import type {
  ListQuery,
  PrintJobEstimateQuery,
  PrintJobUpdateInput,
  PrintJobUploadInput,
} from '@arksen/validation';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Principal, RequestContext } from '../auth/principal.js';
import { diffChanges } from '../common/changes.js';
import { ConsumptionService } from '../consumption/consumption.service.js';
import { PRISMA_APP } from '../database/database.module.js';
import { AnalysisClient } from './analysis.client.js';

/** Fichier reçu par l'API (Multer, en mémoire). */
export interface UploadedPdf {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const summarySelect = {
  id: true,
  name: true,
  fileSize: true,
  pageCount: true,
  colorPages: true,
  averageCyan: true,
  averageMagenta: true,
  averageYellow: true,
  averageBlack: true,
  copies: true,
  createdByEmail: true,
  createdAt: true,
  printer: { select: { id: true, name: true } },
} satisfies Prisma.PrintJobSelect;

type SummaryRow = Prisma.PrintJobGetPayload<{ select: typeof summarySelect }>;
type PageRow = Prisma.PrintJobPageGetPayload<object>;

function toSummary(row: SummaryRow): PrintJobSummary {
  return {
    id: row.id,
    name: row.name,
    fileSize: row.fileSize,
    pageCount: row.pageCount,
    colorPages: row.colorPages,
    averageCoverage: {
      cyan: Number(row.averageCyan),
      magenta: Number(row.averageMagenta),
      yellow: Number(row.averageYellow),
      black: Number(row.averageBlack),
    },
    printer: row.printer,
    copies: row.copies,
    createdByEmail: row.createdByEmail,
    createdAt: row.createdAt.toISOString(),
  };
}

function toPage(row: PageRow): PrintJobPage {
  return {
    number: row.number,
    widthMm: Number(row.widthMm),
    heightMm: Number(row.heightMm),
    format: row.format,
    orientation: row.orientation as PrintJobPage['orientation'],
    areaFactor: Number(row.areaFactor),
    coverage: {
      cyan: Number(row.coverageCyan),
      magenta: Number(row.coverageMagenta),
      yellow: Number(row.coverageYellow),
      black: Number(row.coverageBlack),
    },
    grayCoverage: Number(row.coverageGray),
    isColor: row.isColor,
  };
}

const CHANNEL_KEYS = {
  CYAN: 'cyan',
  MAGENTA: 'magenta',
  YELLOW: 'yellow',
  BLACK: 'black',
} as const satisfies Record<CmykChannel, keyof PrintJobPage['coverage']>;

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Travaux d'impression analysés : un PDF, ses mesures page par page et sa machine prévue.
 * Le fichier lui-même n'est jamais conservé.
 */
@Injectable()
export class PrintJobsService {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    private readonly analysis: AnalysisClient,
    private readonly consumption: ConsumptionService,
    private readonly audit: AuditService,
  ) {}

  async create(
    tenantId: string,
    file: UploadedPdf | undefined,
    input: PrintJobUploadInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<PrintJob> {
    if (!file || file.size === 0) {
      throw new BadRequestException('Joignez un fichier PDF.');
    }
    if (input.printerId) {
      await this.assertPrinter(tenantId, input.printerId);
    }
    const result = await this.analysis.analyze(file.buffer, file.originalname);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    // Le nom d'origine peut arriver en latin-1 depuis certains navigateurs : on le normalise.
    const name =
      Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200) || 'document.pdf';

    // Les pages se créent à part : la clé étrangère composite (job_id, tenant_id) empêche Prisma
    // d'accepter tenantId dans une création imbriquée.
    const job = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const created = await tx.printJob.create({
        data: {
          tenantId,
          name,
          fileSize: file.size,
          fileSha256: sha256,
          pageCount: result.page_count,
          colorPages: result.color_pages,
          method: result.method,
          dpi: result.dpi,
          averageCyan: result.average.cyan,
          averageMagenta: result.average.magenta,
          averageYellow: result.average.yellow,
          averageBlack: result.average.black,
          printerId: input.printerId ?? null,
          copies: input.copies,
          createdById: actor.userId,
          createdByEmail: actor.email,
        },
        select: { id: true },
      });
      await tx.printJobPage.createMany({
        data: result.pages.map((page) => ({
          jobId: created.id,
          tenantId,
          number: page.number,
          widthMm: page.width_mm,
          heightMm: page.height_mm,
          format: page.format,
          orientation: page.orientation,
          areaFactor: page.area_factor,
          coverageCyan: page.cyan,
          coverageMagenta: page.magenta,
          coverageYellow: page.yellow,
          coverageBlack: page.black,
          coverageGray: page.gray,
          isColor: page.is_color,
        })),
      });
      return created;
    });
    await this.audit.record({
      action: 'print_job.analyzed',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'print_job',
      targetId: job.id,
      metadata: { name, pages: result.page_count, colorPages: result.color_pages, sha256 },
      ...context,
    });
    return this.get(tenantId, job.id);
  }

  list(tenantId: string, query: ListQuery): Promise<Page<PrintJobSummary>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const where: Prisma.PrintJobWhereInput = {
        tenantId,
        ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
      };
      const rows = await tx.printJob.findMany({
        where,
        select: summarySelect,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      const total = await tx.printJob.count({ where });
      return { items: rows.map(toSummary), total, page: query.page, pageSize: query.pageSize };
    });
  }

  async get(tenantId: string, jobId: string): Promise<PrintJob> {
    const row = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.printJob.findFirst({
        where: { id: jobId, tenantId },
        select: {
          ...summarySelect,
          fileSha256: true,
          method: true,
          dpi: true,
          pages: { orderBy: { number: 'asc' } },
        },
      }),
    );
    if (!row) throw new NotFoundException('Analyse introuvable.');
    const pages = row.pages.map(toPage);
    const formats = new Map<string, number>();
    for (const page of pages) formats.set(page.format, (formats.get(page.format) ?? 0) + 1);
    return {
      ...toSummary(row),
      fileSha256: row.fileSha256,
      method: row.method,
      dpi: row.dpi,
      formats: [...formats].map(([format, count]) => ({ format, pages: count })),
      pages,
    };
  }

  async update(
    tenantId: string,
    jobId: string,
    input: PrintJobUpdateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<PrintJob> {
    if (input.printerId) await this.assertPrinter(tenantId, input.printerId);
    const { before, after } = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const current = await tx.printJob.findFirst({ where: { id: jobId, tenantId } });
      if (!current) throw new NotFoundException('Analyse introuvable.');
      const updated = await tx.printJob.update({ where: { id: jobId }, data: input });
      return { before: current, after: updated };
    });
    await this.audit.record({
      action: 'print_job.updated',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'print_job',
      targetId: jobId,
      metadata: { name: after.name, changes: diffChanges(Object.keys(input), before, after) },
      ...context,
    });
    return this.get(tenantId, jobId);
  }

  async remove(
    tenantId: string,
    jobId: string,
    actor: Principal,
    context: RequestContext,
  ): Promise<void> {
    const job = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const current = await tx.printJob.findFirst({ where: { id: jobId, tenantId } });
      if (!current) throw new NotFoundException('Analyse introuvable.');
      await tx.printJob.delete({ where: { id: jobId } });
      return current;
    });
    await this.audit.record({
      action: 'print_job.deleted',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'print_job',
      targetId: jobId,
      metadata: { name: job.name },
      ...context,
    });
  }

  /**
   * Rapport de préproduction : toner et coût du travail sur une machine.
   *
   * Les pages sont converties en surfaces A4, et la couverture de chaque canal est la moyenne
   * pondérée par la surface : sur toutes les pages pour le noir, sur les pages couleur pour les
   * autres. Le moteur retrouve ainsi exactement la somme des consommations de chaque page.
   * Sur une machine noir et blanc, le noir suit la couverture en niveaux de gris.
   */
  async estimate(
    tenantId: string,
    jobId: string,
    query: PrintJobEstimateQuery,
  ): Promise<PrintJobEstimate> {
    const job = await this.get(tenantId, jobId);
    const colorMode = await this.assertPrinter(tenantId, query.printerId);
    const copies = query.copies ?? job.copies;
    const grayscale = colorMode === 'MONOCHROME';

    const allArea = job.pages.reduce((sum, page) => sum + page.areaFactor, 0);
    const colorArea = grayscale
      ? 0
      : job.pages.filter((page) => page.isColor).reduce((sum, page) => sum + page.areaFactor, 0);
    const blackOf = (page: PrintJobPage) => (grayscale ? page.grayCoverage : page.coverage.black);
    /** Poids d'une page dans un canal : sa couverture multipliée par sa surface. */
    const weight = (page: PrintJobPage, channel: CmykChannel) => {
      if (channel === 'BLACK') return blackOf(page) * page.areaFactor;
      return !grayscale && page.isColor
        ? page.coverage[CHANNEL_KEYS[channel]] * page.areaFactor
        : 0;
    };
    const average = (channel: CmykChannel, area: number) =>
      area === 0 ? 0 : job.pages.reduce((sum, page) => sum + weight(page, channel), 0) / area;

    const { simulation, printer } = await this.consumption.estimateWork(
      tenantId,
      query.printerId,
      {
        pages: allArea * copies,
        colorPages: colorArea * copies,
        coverage: {
          CYAN: average('CYAN', colorArea),
          MAGENTA: average('MAGENTA', colorArea),
          YELLOW: average('YELLOW', colorArea),
          BLACK: average('BLACK', allArea),
        },
      },
      query.useCalibration,
    );

    // Répartition du toner d'un exemplaire entre les pages, au prorata de leur poids.
    const pages = job.pages.map((page) => {
      const grams: Partial<Record<CmykChannel, number>> = {};
      for (const channel of simulation.channels) {
        const total = job.pages.reduce((sum, item) => sum + weight(item, channel.channel), 0);
        grams[channel.channel] =
          total === 0
            ? 0
            : round((channel.estimatedGrams / copies) * (weight(page, channel.channel) / total), 4);
      }
      return {
        number: page.number,
        grams,
        totalGrams: round(
          Object.values(grams).reduce((sum, value) => sum + value, 0),
          4,
        ),
      };
    });

    return {
      printer: { id: printer.id, name: printer.name, colorMode: printer.colorMode },
      copies,
      currency: simulation.currency,
      a4EquivalentPages: round(allArea * copies, 2),
      grayscale,
      channels: simulation.channels,
      totals: simulation.totals,
      costPerCopy:
        simulation.totals.costEstimated === null
          ? null
          : round(simulation.totals.costEstimated / copies, 4),
      pages,
    };
  }

  /** La machine doit appartenir à l'entreprise ; renvoie son mode d'impression. */
  private async assertPrinter(tenantId: string, printerId: string) {
    const printer = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.printer.findFirst({
        where: { id: printerId, tenantId },
        select: { model: { select: { colorMode: true } } },
      }),
    );
    if (!printer) throw new BadRequestException('Machine introuvable dans cette entreprise.');
    return printer.model.colorMode;
  }
}
