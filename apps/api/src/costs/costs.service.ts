import { withTenant, type PrismaClient } from '@arksen/database';
import type { CostGap, CostReport, PrinterCost, PrinterCostSettings } from '@arksen/shared-types';
import type { PeriodQuery, PrinterCostSettingsInput } from '@arksen/validation';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Principal, RequestContext } from '../auth/principal.js';
import { ConsumptionService } from '../consumption/consumption.service.js';
import { PRISMA_APP } from '../database/database.module.js';
import { computeCosts, sumCosts } from './cost-model.js';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CostsService {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    private readonly consumption: ConsumptionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Coûts d'impression de chaque machine sur la période : volumes relevés et toner du moteur
   * CMJN, papier, interventions terminées et coûts fixes. `printerIds` restreint le calcul
   * (machines d'un contrat).
   */
  async report(tenantId: string, query: PeriodQuery, printerIds?: string[]): Promise<CostReport> {
    const fleet = await this.consumption.fleetConsumption(tenantId, {
      from: query.from,
      to: query.to,
      ...(query.siteId ? { siteId: query.siteId } : {}),
    });
    const wanted = printerIds ? new Set(printerIds) : null;
    const consumptions = fleet.printers.filter((item) => !wanted || wanted.has(item.printerId));
    const ids = consumptions.map((item) => item.printerId);
    const end = new Date(Date.parse(query.to) + DAY_MS);

    const { settings, interventions } = await withTenant(this.appPrisma, tenantId, async (tx) => ({
      settings: await tx.printerCostSettings.findMany({
        where: { tenantId, printerId: { in: ids } },
        include: { paperType: { select: { reamPrice: true, sheetsPerReam: true } } },
      }),
      interventions: await tx.intervention.findMany({
        where: {
          tenantId,
          printerId: { in: ids },
          status: 'DONE',
          completedAt: { gte: new Date(query.from), lt: end },
        },
        select: { printerId: true, laborCost: true, partsCost: true },
      }),
    }));
    const settingsOf = new Map(settings.map((item) => [item.printerId, item]));
    const maintenanceOf = new Map<string, number>();
    for (const item of interventions) {
      maintenanceOf.set(
        item.printerId,
        (maintenanceOf.get(item.printerId) ?? 0) +
          Number(item.laborCost ?? 0) +
          Number(item.partsCost ?? 0),
      );
    }
    const days = (Date.parse(query.to) - Date.parse(query.from)) / DAY_MS + 1;

    const rows = consumptions.map((item) => {
      const setting = settingsOf.get(item.printerId);
      const black = item.channels.find((channel) => channel.channel === 'BLACK');
      const colors = item.channels.filter((channel) => channel.channel !== 'BLACK');
      const blackToner = black ? black.costEstimated : null;
      const colorToner =
        item.colorMode === 'MONOCHROME'
          ? 0
          : colors.length === 3 && colors.every((channel) => channel.costEstimated !== null)
            ? colors.reduce((sum, channel) => sum + channel.costEstimated!, 0)
            : null;
      const sheetPrice =
        setting?.paperType?.reamPrice != null
          ? Number(setting.paperType.reamPrice) / setting.paperType.sheetsPerReam
          : null;
      const duplexPercent = setting ? Number(setting.duplexPercent) : 0;
      const costs = computeCosts({
        pages: item.pages.total,
        colorPages: item.pages.color,
        blackToner,
        colorToner,
        sheetPrice,
        duplexPercent,
        maintenance: maintenanceOf.get(item.printerId) ?? 0,
        monthlyFixed: setting?.monthlyFixedCost != null ? Number(setting.monthlyFixedCost) : null,
        days,
      });
      const gaps: CostGap[] = [];
      if (item.pages.total === 0) gaps.push('NO_PAGES');
      if (costs.toner === null && item.pages.total > 0) gaps.push('NO_TONER_COST');
      if (costs.paper === null && item.pages.total > 0) gaps.push('NO_PAPER');
      const cost: PrinterCost = {
        ...costs,
        printer: {
          id: item.printerId,
          name: item.name,
          siteName: item.siteName,
          colorMode: item.colorMode,
        },
        settings: toSettings(item.printerId, setting ?? null),
        coverage: item.pages.coverage,
        gaps,
      };
      return { cost, blackToner, colorToner };
    });

    return {
      from: query.from,
      to: query.to,
      currency: fleet.currency,
      totals: sumCosts(
        rows.map((row) => ({
          ...row.cost,
          blackToner: row.blackToner,
          colorToner: row.colorToner,
        })),
      ),
      printers: rows
        .map((row) => row.cost)
        .sort((a, b) => b.total - a.total || a.printer.name.localeCompare(b.printer.name, 'fr')),
    };
  }

  async settings(tenantId: string, printerId: string): Promise<PrinterCostSettings> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const printer = await tx.printer.findFirst({
        where: { id: printerId, tenantId },
        select: { id: true },
      });
      if (!printer) throw new NotFoundException('Machine introuvable.');
      const row = await tx.printerCostSettings.findUnique({ where: { printerId } });
      return toSettings(printerId, row);
    });
  }

  async saveSettings(
    tenantId: string,
    printerId: string,
    input: PrinterCostSettingsInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<PrinterCostSettings> {
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const printer = await tx.printer.findFirst({
        where: { id: printerId, tenantId },
        select: { id: true },
      });
      if (!printer) throw new NotFoundException('Machine introuvable.');
      if (input.paperTypeId) {
        const paper = await tx.paperType.findFirst({ where: { id: input.paperTypeId, tenantId } });
        if (!paper) throw new BadRequestException('Papier introuvable dans cette entreprise.');
      }
      return tx.printerCostSettings.upsert({
        where: { printerId },
        create: { printerId, tenantId, ...input },
        update: input,
      });
    });
    await this.audit.record({
      action: 'printer.cost_settings_updated',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'printer',
      targetId: printerId,
      metadata: { ...input },
      ...context,
    });
    return toSettings(printerId, row);
  }
}

function toSettings(
  printerId: string,
  row: {
    paperTypeId: string | null;
    duplexPercent: unknown;
    monthlyFixedCost: unknown;
    updatedAt: Date;
  } | null,
): PrinterCostSettings {
  return {
    printerId,
    paperTypeId: row?.paperTypeId ?? null,
    duplexPercent: row ? Number(row.duplexPercent) : 0,
    monthlyFixedCost: row?.monthlyFixedCost == null ? null : Number(row.monthlyFixedCost),
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}
