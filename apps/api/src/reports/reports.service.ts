import { withTenant, type PrismaClient } from '@arksen/database';
import {
  CMYK_CHANNELS,
  CMYK_LABELS,
  COST_GAP_LABELS,
  hasPermission,
  INTERVENTION_STATUS_LABELS,
  INTERVENTION_TYPE_LABELS,
  MAINTENANCE_STATE_LABELS,
  REPORTS,
  STOCK_LEVEL_LABELS,
  type ClientProfitability,
  type MonthlyStatistic,
  type ReportType,
  type Statistics,
} from '@arksen/shared-types';
import type { ReportQuery, StatisticsQuery } from '@arksen/validation';
import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Principal, RequestContext } from '../auth/principal.js';
import { ConsumptionService } from '../consumption/consumption.service.js';
import { CostsService } from '../costs/costs.service.js';
import { PRISMA_APP } from '../database/database.module.js';
import { MaintenanceService } from '../maintenance/maintenance.service.js';
import { PaperService } from '../paper/paper.service.js';
import { StocksService } from '../stocks/stocks.service.js';
import { renderCsv } from './render-csv.js';
import { renderPdf } from './render-pdf.js';
import { renderXlsx } from './render-xlsx.js';
import type { ReportDocument, ReportSection } from './report-model.js';

const DAY_MS = 86_400_000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const money = (value: number | null, currency: string) =>
  value === null
    ? '—'
    : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value)} ${currency}`;

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
} as const;

export interface ExportedReport {
  filename: string;
  contentType: string;
  body: Buffer;
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    private readonly consumption: ConsumptionService,
    private readonly costs: CostsService,
    private readonly stocks: StocksService,
    private readonly paper: PaperService,
    private readonly maintenance: MaintenanceService,
    private readonly audit: AuditService,
  ) {}

  /** Construit, met en forme et journalise l'export d'un rapport. */
  async export(
    tenantId: string,
    type: ReportType,
    query: ReportQuery,
    actor: Principal,
    context: RequestContext,
  ): Promise<ExportedReport> {
    const definition = REPORTS[type];
    const missing = definition.permissions.filter(
      (permission) => !hasPermission(actor.role, permission),
    );
    if (missing.length)
      throw new ForbiddenException('Ce rapport demande des droits que vous n’avez pas.');

    const today = isoDay(new Date());
    const period = definition.period
      ? { from: query.from ?? isoDay(new Date(Date.now() - 29 * DAY_MS)), to: query.to ?? today }
      : null;
    if (period && period.to > today)
      throw new BadRequestException('La période ne peut pas finir dans le futur.');

    const document = await this.build(tenantId, type, period, query.siteId);
    const body =
      query.format === 'pdf'
        ? await renderPdf(document)
        : query.format === 'xlsx'
          ? await renderXlsx(document)
          : renderCsv(document);
    await this.audit.record({
      action: 'report.exported',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'report',
      metadata: { type, format: query.format, ...(period ?? {}), siteId: query.siteId ?? null },
      ...context,
    });
    const suffix = period ? `${period.from}_${period.to}` : today;
    return {
      filename: `arksen-${document.slug}-${suffix}.${query.format}`,
      contentType: CONTENT_TYPES[query.format],
      body,
    };
  }

  private async header(tenantId: string) {
    return withTenant(this.appPrisma, tenantId, (tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { name: true, currency: true },
      }),
    );
  }

  async build(
    tenantId: string,
    type: ReportType,
    period: { from: string; to: string } | null,
    siteId?: string,
  ): Promise<ReportDocument> {
    const tenant = await this.header(tenantId);
    const base = {
      slug: type,
      title: REPORTS[type].title,
      tenantName: tenant.name,
      period,
      generatedAt: new Date(),
      currency: tenant.currency,
    };
    const range = period ? { ...period, ...(siteId ? { siteId } : {}) } : null;
    const c = tenant.currency;

    switch (type) {
      case 'production': {
        const fleet = await this.consumption.fleetConsumption(tenantId, range!);
        const rows = fleet.printers.map((printer) => ({
          name: printer.name,
          site: printer.siteName,
          black: Math.round(printer.pages.total - printer.pages.color),
          color: Math.round(printer.pages.color),
          total: Math.round(printer.pages.total),
          coverage: round(printer.pages.coverage * 100, 1),
        }));
        const total = rows.reduce((sum, row) => sum + row.total, 0);
        const color = rows.reduce((sum, row) => sum + row.color, 0);
        return {
          ...base,
          notes: [
            'Pages déduites des relevés de compteurs, réparties à parts égales entre deux relevés. La couverture est la part de la période encadrée par des relevés.',
          ],
          sections: [
            {
              title: 'Pages par machine',
              kpis: [
                { label: 'Pages imprimées', value: integer.format(total) },
                { label: 'Dont couleur', value: integer.format(color) },
                {
                  label: 'Part couleur',
                  value: total ? `${round((color / total) * 100, 1)} %` : '—',
                },
              ],
              columns: [
                { key: 'name', label: 'Machine', kind: 'text', width: 2 },
                { key: 'site', label: 'Site', kind: 'text', width: 1.6 },
                { key: 'black', label: 'Noir et blanc', kind: 'int' },
                { key: 'color', label: 'Couleur', kind: 'int' },
                { key: 'total', label: 'Total', kind: 'int' },
                { key: 'coverage', label: 'Relevés', kind: 'percent' },
              ],
              rows: rows.sort((a, b) => b.total - a.total),
              total: {
                name: 'Total',
                site: '',
                black: total - color,
                color,
                total,
                coverage: null,
              },
            },
          ],
        };
      }

      case 'consumption-cmyk': {
        const fleet = await this.consumption.fleetConsumption(tenantId, range!);
        const channels: ReportSection = {
          title: 'Par couleur',
          kpis: [
            { label: 'Toner estimé', value: `${integer.format(fleet.totals.estimatedGrams)} g` },
            {
              label: 'Toner théorique',
              value: `${integer.format(fleet.totals.theoreticalGrams)} g`,
            },
            { label: 'Coût toner', value: money(fleet.totals.costEstimated, c) },
          ],
          columns: [
            { key: 'channel', label: 'Couleur', kind: 'text', width: 1.5 },
            { key: 'theoretical', label: 'Théorique (g)', kind: 'decimal' },
            { key: 'estimated', label: 'Estimé (g)', kind: 'decimal' },
            { key: 'gap', label: 'Écart calibration', kind: 'percent' },
            { key: 'cost', label: 'Coût estimé', kind: 'money' },
          ],
          rows: fleet.channels.map((channel) => ({
            channel: CMYK_LABELS[channel.channel],
            theoretical: round(channel.theoreticalGrams),
            estimated: round(channel.estimatedGrams),
            gap: channel.theoreticalGrams
              ? round(
                  ((channel.estimatedGrams - channel.theoreticalGrams) / channel.theoreticalGrams) *
                    100,
                  1,
                )
              : null,
            cost: channel.costEstimated,
          })),
        };
        const perPrinter: ReportSection = {
          title: 'Par machine',
          description: 'Toner estimé par couleur, en grammes.',
          columns: [
            { key: 'name', label: 'Machine', kind: 'text', width: 2 },
            ...CMYK_CHANNELS.map((channel) => ({
              key: channel,
              label: CMYK_LABELS[channel],
              kind: 'decimal' as const,
            })),
            { key: 'cost', label: 'Coût', kind: 'money' },
          ],
          rows: fleet.printers.map((printer) => ({
            name: printer.name,
            ...Object.fromEntries(
              CMYK_CHANNELS.map((channel) => [
                channel,
                printer.channels.find((item) => item.channel === channel)?.estimatedGrams ?? null,
              ]),
            ),
            cost: printer.totals?.costEstimated ?? null,
          })),
        };
        return {
          ...base,
          notes: [
            'Consommation théorique : rendement constructeur ramené à l’aplat de chaque machine. Consommation estimée : théorique corrigée par la calibration de la machine (consommations réelles mesurées).',
          ],
          sections: [channels, perPrinter],
        };
      }

      case 'consumption-printer': {
        const fleet = await this.consumption.fleetConsumption(tenantId, range!);
        return {
          ...base,
          notes: ['Coût toner au prix d’achat des cartouches de l’entreprise.'],
          sections: [
            {
              title: 'Consommation par machine',
              columns: [
                { key: 'name', label: 'Machine', kind: 'text', width: 2 },
                { key: 'site', label: 'Site', kind: 'text', width: 1.5 },
                { key: 'pages', label: 'Pages', kind: 'int' },
                { key: 'theoretical', label: 'Théorique (g)', kind: 'decimal' },
                { key: 'estimated', label: 'Estimé (g)', kind: 'decimal' },
                { key: 'cost', label: 'Coût toner', kind: 'money' },
                { key: 'perPage', label: 'Par page', kind: 'decimal' },
              ],
              rows: fleet.printers.map((printer) => ({
                name: printer.name,
                site: printer.siteName,
                pages: Math.round(printer.pages.total),
                theoretical: printer.totals ? round(printer.totals.theoreticalGrams) : null,
                estimated: printer.totals ? round(printer.totals.estimatedGrams) : null,
                cost: printer.totals?.costEstimated ?? null,
                perPage:
                  printer.totals?.costPerPage === null || !printer.totals
                    ? null
                    : round(printer.totals.costPerPage!, 4),
              })),
              total: {
                name: 'Total',
                site: '',
                pages: Math.round(fleet.totals.pages),
                theoretical: round(fleet.totals.theoreticalGrams),
                estimated: round(fleet.totals.estimatedGrams),
                cost: fleet.totals.costEstimated,
                perPage:
                  fleet.totals.costPerPage === null ? null : round(fleet.totals.costPerPage, 4),
              },
            },
          ],
        };
      }

      case 'consumption-client': {
        const fleet = await this.consumption.fleetConsumption(tenantId, range!);
        const links = await withTenant(this.appPrisma, tenantId, (tx) =>
          tx.contractPrinter.findMany({
            where: { tenantId },
            include: { contract: { select: { reference: true, customerName: true } } },
          }),
        );
        const clientOf = new Map(links.map((link) => [link.printerId, link.contract]));
        const groups = new Map<
          string,
          {
            client: string;
            reference: string;
            printers: number;
            pages: number;
            color: number;
            grams: number;
            cost: number | null;
          }
        >();
        for (const printer of fleet.printers) {
          const contract = clientOf.get(printer.printerId);
          const key = contract?.reference ?? '';
          const group = groups.get(key) ?? {
            client: contract?.customerName ?? 'Hors contrat',
            reference: contract?.reference ?? '—',
            printers: 0,
            pages: 0,
            color: 0,
            grams: 0,
            cost: 0,
          };
          group.printers += 1;
          group.pages += printer.pages.total;
          group.color += printer.pages.color;
          group.grams += printer.totals?.estimatedGrams ?? 0;
          group.cost =
            group.cost === null || printer.totals?.costEstimated == null
              ? printer.pages.total > 0
                ? null
                : group.cost
              : group.cost + printer.totals.costEstimated;
          groups.set(key, group);
        }
        return {
          ...base,
          notes: ['Une machine compte pour le contrat qui la couvre aujourd’hui.'],
          sections: [
            {
              title: 'Consommation par client',
              columns: [
                { key: 'client', label: 'Client', kind: 'text', width: 2.2 },
                { key: 'reference', label: 'Contrat', kind: 'text', width: 1.2 },
                { key: 'printers', label: 'Machines', kind: 'int' },
                { key: 'pages', label: 'Pages', kind: 'int' },
                { key: 'color', label: 'Dont couleur', kind: 'int' },
                { key: 'grams', label: 'Toner (g)', kind: 'decimal' },
                { key: 'cost', label: 'Coût toner', kind: 'money' },
              ],
              rows: [...groups.values()]
                .map((group) => ({
                  ...group,
                  pages: Math.round(group.pages),
                  color: Math.round(group.color),
                  grams: round(group.grams),
                }))
                .sort((a, b) => b.pages - a.pages),
            },
          ],
        };
      }

      case 'costs': {
        const report = await this.costs.report(tenantId, range!);
        const totals = report.totals;
        return {
          ...base,
          notes: [
            'Toner estimé par le moteur CMJN ; papier = pages × (1 − recto verso / 2) × prix de la feuille ; interventions terminées sur la période ; coûts fixes mensuels au prorata.',
            'Coût copie noir et blanc : toner noir et coûts communs. Coût copie couleur : y ajoute les toners cyan, magenta et jaune, répartis sur les pages couleur.',
          ],
          sections: [
            {
              title: 'Coûts par machine',
              kpis: [
                { label: 'Coût d’impression', value: money(totals.total, c) },
                {
                  label: 'Coût copie N&B',
                  value:
                    totals.costPerBlackPage === null
                      ? '—'
                      : `${round(totals.costPerBlackPage, 4)} ${c}`,
                },
                {
                  label: 'Coût copie couleur',
                  value:
                    totals.costPerColorPage === null
                      ? '—'
                      : `${round(totals.costPerColorPage, 4)} ${c}`,
                },
              ],
              columns: [
                { key: 'name', label: 'Machine', kind: 'text', width: 1.8 },
                { key: 'pages', label: 'Pages', kind: 'int' },
                { key: 'toner', label: 'Toner', kind: 'money' },
                { key: 'paper', label: 'Papier', kind: 'money' },
                { key: 'maintenance', label: 'Interventions', kind: 'money' },
                { key: 'fixed', label: 'Fixes', kind: 'money' },
                { key: 'total', label: 'Total', kind: 'money' },
                { key: 'black', label: 'Copie N&B', kind: 'decimal' },
                { key: 'color', label: 'Copie couleur', kind: 'decimal' },
                { key: 'gaps', label: 'Lacunes', kind: 'text', width: 1.6 },
              ],
              rows: report.printers.map((printer) => ({
                name: printer.printer.name,
                pages: Math.round(printer.pages),
                toner: printer.toner,
                paper: printer.paper,
                maintenance: printer.maintenance,
                fixed: printer.fixed,
                total: printer.total,
                black:
                  printer.costPerBlackPage === null ? null : round(printer.costPerBlackPage, 4),
                color:
                  printer.costPerColorPage === null ? null : round(printer.costPerColorPage, 4),
                gaps: printer.gaps.map((gap) => COST_GAP_LABELS[gap]).join(', '),
              })),
              total: {
                name: 'Total',
                pages: Math.round(totals.pages),
                toner: totals.toner,
                paper: totals.paper,
                maintenance: totals.maintenance,
                fixed: totals.fixed,
                total: totals.total,
                black: totals.costPerBlackPage === null ? null : round(totals.costPerBlackPage, 4),
                color: totals.costPerColorPage === null ? null : round(totals.costPerColorPage, 4),
                gaps: '',
              },
            },
          ],
        };
      }

      case 'toner-yield': {
        const references = await this.stocks.references(tenantId);
        return {
          ...base,
          notes: [
            'Rendement constaté : pages imprimées entre deux remplacements successifs d’une même cartouche (compteur noir pour le noir, couleur pour le cyan, le magenta et le jaune).',
          ],
          sections: [
            {
              title: 'Rendement par référence',
              columns: [
                { key: 'reference', label: 'Référence', kind: 'text', width: 1.4 },
                { key: 'channel', label: 'Couleur', kind: 'text' },
                { key: 'models', label: 'Modèles', kind: 'text', width: 2.4 },
                { key: 'printers', label: 'Machines', kind: 'int' },
                { key: 'yield', label: 'Constructeur', kind: 'int' },
                { key: 'observed', label: 'Constaté', kind: 'int' },
                { key: 'ratio', label: 'Rapport', kind: 'percent' },
                { key: 'samples', label: 'Mesures', kind: 'int' },
                { key: 'replacements', label: 'Remplacements 90 j', kind: 'int' },
              ],
              rows: references.map((reference) => ({
                reference: reference.reference,
                channel: CMYK_LABELS[reference.channel],
                models: reference.models.map((model) => model.name).join(', '),
                printers: reference.printers,
                yield: reference.yieldPages,
                observed: reference.averageYield,
                ratio:
                  reference.averageYield === null
                    ? null
                    : round((reference.averageYield / reference.yieldPages) * 100, 1),
                samples: reference.yieldSamples,
                replacements: reference.replacements90d,
              })),
            },
          ],
        };
      }

      case 'stocks': {
        const toners = await this.stocks.list(tenantId, {
          page: 1,
          pageSize: 1000,
          search: undefined,
          ...(siteId ? { siteId } : {}),
        });
        const papers = await this.paper.stocks(tenantId, {
          page: 1,
          pageSize: 1000,
          search: undefined,
          ...(siteId ? { siteId } : {}),
        });
        return {
          ...base,
          notes: [
            'Couverture : jours de stock au rythme de consommation des 90 derniers jours (moteur CMJN pour le toner, pages des machines pour le papier). Commande conseillée : de quoi couvrir le délai de réapprovisionnement et 30 jours.',
          ],
          sections: [
            {
              title: 'Toners',
              columns: [
                { key: 'reference', label: 'Référence', kind: 'text', width: 1.4 },
                { key: 'site', label: 'Site', kind: 'text', width: 1.6 },
                { key: 'quantity', label: 'Stock', kind: 'int' },
                { key: 'min', label: 'Seuil', kind: 'int' },
                { key: 'level', label: 'Niveau', kind: 'text' },
                { key: 'cover', label: 'Couverture (j)', kind: 'decimal' },
                { key: 'order', label: 'À commander', kind: 'int' },
                { key: 'value', label: 'Valeur', kind: 'money' },
              ],
              rows: toners.items.map((stock) => ({
                reference: stock.reference,
                site: stock.site.name,
                quantity: stock.quantity,
                min: stock.minQuantity,
                level: STOCK_LEVEL_LABELS[stock.level],
                cover: stock.forecast.daysOfCover,
                order: stock.forecast.recommendedOrder,
                value: stock.value,
              })),
            },
            {
              title: 'Papier (rames)',
              columns: [
                { key: 'paper', label: 'Papier', kind: 'text', width: 1.6 },
                { key: 'site', label: 'Site', kind: 'text', width: 1.6 },
                { key: 'quantity', label: 'Stock', kind: 'int' },
                { key: 'min', label: 'Seuil', kind: 'int' },
                { key: 'level', label: 'Niveau', kind: 'text' },
                { key: 'cover', label: 'Couverture (j)', kind: 'decimal' },
                { key: 'order', label: 'À commander', kind: 'int' },
                { key: 'value', label: 'Valeur', kind: 'money' },
              ],
              rows: papers.items.map((stock) => ({
                paper: stock.paperType.name,
                site: stock.site.name,
                quantity: stock.quantity,
                min: stock.minQuantity,
                level: STOCK_LEVEL_LABELS[stock.level],
                cover: stock.forecast.daysOfCover,
                order: stock.forecast.recommendedOrder,
                value: stock.value,
              })),
            },
          ],
        };
      }

      case 'maintenance': {
        const end = new Date(Date.parse(period!.to) + DAY_MS);
        const interventions = await withTenant(this.appPrisma, tenantId, (tx) =>
          tx.intervention.findMany({
            where: {
              tenantId,
              ...(siteId ? { printer: { siteId } } : {}),
              OR: [
                { reportedAt: { gte: new Date(period!.from), lt: end } },
                { completedAt: { gte: new Date(period!.from), lt: end } },
              ],
            },
            include: { printer: { select: { name: true } } },
            orderBy: { number: 'asc' },
          }),
        );
        const plans = await this.maintenance.plans(tenantId);
        const done = interventions.filter((item) => item.status === 'DONE');
        const cost = done.reduce(
          (sum, item) => sum + Number(item.laborCost ?? 0) + Number(item.partsCost ?? 0),
          0,
        );
        return {
          ...base,
          notes: [
            'Une maintenance est « à prévoir » à 90 % de son intervalle, en pages ou en jours.',
          ],
          sections: [
            {
              title: 'Interventions',
              kpis: [
                { label: 'Interventions', value: integer.format(interventions.length) },
                { label: 'Terminées', value: integer.format(done.length) },
                { label: 'Coût', value: money(cost, c) },
              ],
              columns: [
                { key: 'number', label: 'N°', kind: 'int', width: 0.5 },
                { key: 'printer', label: 'Machine', kind: 'text', width: 1.6 },
                { key: 'type', label: 'Type', kind: 'text', width: 1.3 },
                { key: 'title', label: 'Objet', kind: 'text', width: 2.6 },
                { key: 'status', label: 'Statut', kind: 'text' },
                { key: 'reported', label: 'Signalée', kind: 'date' },
                { key: 'completed', label: 'Terminée', kind: 'date' },
                { key: 'cost', label: 'Coût', kind: 'money' },
              ],
              rows: interventions.map((item) => ({
                number: item.number,
                printer: item.printer.name,
                type: INTERVENTION_TYPE_LABELS[item.type],
                title: item.title,
                status: INTERVENTION_STATUS_LABELS[item.status],
                reported: isoDay(item.reportedAt),
                completed: item.completedAt ? isoDay(item.completedAt) : null,
                cost:
                  item.laborCost === null && item.partsCost === null
                    ? null
                    : Number(item.laborCost ?? 0) + Number(item.partsCost ?? 0),
              })),
            },
            {
              title: 'Plans de maintenance préventive',
              columns: [
                { key: 'printer', label: 'Machine', kind: 'text', width: 1.6 },
                { key: 'name', label: 'Plan', kind: 'text', width: 1.8 },
                { key: 'interval', label: 'Intervalle', kind: 'text', width: 1.6 },
                { key: 'progress', label: 'Avancement', kind: 'percent' },
                { key: 'state', label: 'État', kind: 'text' },
                { key: 'due', label: 'Échéance', kind: 'date' },
              ],
              rows: plans.map((plan) => ({
                printer: plan.printer.name,
                name: plan.name,
                interval: [
                  plan.intervalPages && `${integer.format(plan.intervalPages)} pages`,
                  plan.intervalDays && `${plan.intervalDays} jours`,
                ]
                  .filter(Boolean)
                  .join(' / '),
                progress: plan.progress === null ? null : round(plan.progress * 100, 1),
                state: plan.active ? MAINTENANCE_STATE_LABELS[plan.state] : 'Suspendu',
                due: plan.dueAt ? plan.dueAt.slice(0, 10) : null,
              })),
            },
          ],
        };
      }

      case 'profitability': {
        const { invoices, jobs } = await this.profitabilityData(tenantId, period!);
        const clients = clientProfitability(invoices);
        const revenue = clients.reduce((sum, client) => sum + client.revenue, 0);
        const cost = clients.reduce((sum, client) => sum + client.cost, 0);
        const jobRows = jobs.map((job) => {
          const jobCost =
            job.tonerCost === null && job.paperCost === null
              ? null
              : Number(job.tonerCost ?? 0) + Number(job.paperCost ?? 0);
          const price = job.salePrice === null ? null : Number(job.salePrice);
          return {
            name: job.name,
            printedAt: isoDay(job.printedAt!),
            copies: job.copies,
            cost: jobCost === null ? null : round(jobCost),
            price,
            margin: price === null || jobCost === null ? null : round(price - jobCost),
          };
        });
        return {
          ...base,
          notes: [
            'Contrats : relevés émis dont la période se termine dans la période du rapport ; coût de revient des machines figé au relevé. Travaux : impressions enregistrées, coût de revient toner et papier.',
          ],
          sections: [
            {
              title: 'Rentabilité par client',
              kpis: [
                { label: 'Chiffre d’affaires', value: money(revenue, c) },
                { label: 'Coût de revient', value: money(cost, c) },
                { label: 'Marge', value: money(revenue - cost, c) },
              ],
              columns: [
                { key: 'customerName', label: 'Client', kind: 'text', width: 2.2 },
                { key: 'reference', label: 'Contrat', kind: 'text', width: 1.2 },
                { key: 'revenue', label: 'Chiffre d’affaires', kind: 'money' },
                { key: 'cost', label: 'Coût de revient', kind: 'money' },
                { key: 'margin', label: 'Marge', kind: 'money' },
                { key: 'marginRate', label: 'Taux de marge', kind: 'percent' },
              ],
              rows: clients.map((client) => ({ ...client })),
            },
            {
              title: 'Travaux imprimés',
              columns: [
                { key: 'name', label: 'Travail', kind: 'text', width: 2.6 },
                { key: 'printedAt', label: 'Imprimé le', kind: 'date' },
                { key: 'copies', label: 'Exemplaires', kind: 'int' },
                { key: 'cost', label: 'Coût', kind: 'money' },
                { key: 'price', label: 'Prix', kind: 'money' },
                { key: 'margin', label: 'Marge', kind: 'money' },
              ],
              rows: jobRows,
            },
          ],
        };
      }
    }
  }

  private async profitabilityData(tenantId: string, period: { from: string; to: string }) {
    const end = new Date(Date.parse(period.to) + DAY_MS);
    return withTenant(this.appPrisma, tenantId, async (tx) => ({
      invoices: await tx.invoice.findMany({
        where: { tenantId, status: 'ISSUED', periodEnd: { gte: new Date(period.from), lt: end } },
        include: { contract: { select: { id: true, reference: true, customerName: true } } },
        orderBy: { periodEnd: 'asc' },
      }),
      jobs: await tx.printJob.findMany({
        where: { tenantId, printedAt: { gte: new Date(period.from), lt: end } },
        select: {
          name: true,
          printedAt: true,
          copies: true,
          tonerCost: true,
          paperCost: true,
          salePrice: true,
        },
        orderBy: { printedAt: 'asc' },
      }),
    }));
  }

  /**
   * Statistiques des derniers mois : volumes, coûts et chiffre d'affaires mois par mois,
   * machines les plus sollicitées et rentabilité par client sur la fenêtre.
   */
  async statistics(tenantId: string, query: StatisticsQuery): Promise<Statistics> {
    const now = new Date();
    const windows = Array.from({ length: query.months }, (_, index) => {
      const offset = query.months - 1 - index;
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 0));
      return {
        month: isoDay(start).slice(0, 7),
        from: isoDay(start),
        to: isoDay(end > now ? now : end),
      };
    });
    const site = query.siteId ? { siteId: query.siteId } : {};
    const window = { from: windows[0]!.from, to: windows.at(-1)!.to };
    const { invoices } = await this.profitabilityData(tenantId, window);

    const months: MonthlyStatistic[] = [];
    for (const item of windows) {
      const report = await this.costs.report(tenantId, { from: item.from, to: item.to, ...site });
      months.push({
        month: item.month,
        pages: Math.round(report.totals.pages),
        colorPages: Math.round(report.totals.colorPages),
        tonerCost: report.totals.toner,
        totalCost: report.totals.total,
        costPerPage: report.totals.costPerPage,
        revenue: round(
          invoices
            .filter((invoice) => isoDay(invoice.periodEnd).slice(0, 7) === item.month)
            .reduce((sum, invoice) => sum + Number(invoice.totalAmount), 0),
        ),
      });
    }
    const overall = await this.costs.report(tenantId, { ...window, ...site });
    return {
      currency: overall.currency,
      months,
      topPrinters: [...overall.printers]
        .sort((a, b) => b.pages - a.pages)
        .slice(0, 5)
        .map((printer) => ({
          id: printer.printer.id,
          name: printer.printer.name,
          siteName: printer.printer.siteName,
          pages: Math.round(printer.pages),
          costPerPage: printer.costPerPage,
        })),
      clients: clientProfitability(invoices),
    };
  }
}

/** Chiffre d'affaires, coût et marge des relevés émis, regroupés par contrat. */
export function clientProfitability(
  invoices: {
    totalAmount: unknown;
    cost: unknown;
    contract: { id: string; reference: string; customerName: string };
  }[],
): ClientProfitability[] {
  const byContract = new Map<string, ClientProfitability>();
  for (const invoice of invoices) {
    const current = byContract.get(invoice.contract.id) ?? {
      contractId: invoice.contract.id,
      reference: invoice.contract.reference,
      customerName: invoice.contract.customerName,
      revenue: 0,
      cost: 0,
      margin: 0,
      marginRate: null,
    };
    current.revenue += Number(invoice.totalAmount);
    current.cost += invoice.cost === null ? 0 : Number(invoice.cost);
    byContract.set(invoice.contract.id, current);
  }
  return [...byContract.values()]
    .map((client) => ({
      ...client,
      revenue: round(client.revenue),
      cost: round(client.cost),
      margin: round(client.revenue - client.cost),
      marginRate: client.revenue
        ? round(((client.revenue - client.cost) / client.revenue) * 100, 1)
        : null,
    }))
    .sort((a, b) => b.margin - a.margin);
}
