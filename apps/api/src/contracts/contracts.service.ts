import { Prisma, withTenant, type PrismaClient } from '@arksen/database';
import type { Contract, Invoice, InvoiceLine, Page } from '@arksen/shared-types';
import type {
  ContractCreateInput,
  ContractPrintersInput,
  ContractUpdateInput,
  InvoiceCreateInput,
  InvoiceListQuery,
  ListQuery,
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
import { nextNumber } from '../common/sequence.js';
import { ConsumptionService } from '../consumption/consumption.service.js';
import { CostsService } from '../costs/costs.service.js';
import { PRISMA_APP } from '../database/database.module.js';
import { bill, invoiceNumber } from './billing.js';

const contractInclude = {
  printers: {
    include: {
      printer: {
        select: { id: true, name: true, serialNumber: true, site: { select: { name: true } } },
      },
    },
  },
  invoices: {
    where: { status: { not: 'CANCELLED' as const } },
    orderBy: { periodEnd: 'desc' as const },
    take: 1,
    select: { id: true, number: true, periodEnd: true, status: true },
  },
} as const;
type ContractRow = Prisma.ContractGetPayload<{ include: typeof contractInclude }>;
const invoiceInclude = {
  contract: { select: { id: true, reference: true, customerName: true } },
} as const;
type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

const day = (value: Date) => value.toISOString().slice(0, 10);

@Injectable()
export class ContractsService {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    private readonly consumption: ConsumptionService,
    private readonly costs: CostsService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, query: ListQuery): Promise<Page<Contract>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const { currency } = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      });
      const search = query.search?.trim();
      const where: Prisma.ContractWhereInput = {
        tenantId,
        ...(search
          ? {
              OR: [
                { reference: { contains: search, mode: 'insensitive' } },
                { customerName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const total = await tx.contract.count({ where });
      const rows = await tx.contract.findMany({
        where,
        include: contractInclude,
        orderBy: [{ status: 'asc' }, { customerName: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return {
        items: rows.map((row) => toContract(row, currency)),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async get(tenantId: string, contractId: string): Promise<Contract> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const { currency } = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      });
      const row = await tx.contract.findFirst({
        where: { id: contractId, tenantId },
        include: contractInclude,
      });
      if (!row) throw new NotFoundException('Contrat introuvable.');
      return toContract(row, currency);
    });
  }

  async create(
    tenantId: string,
    input: ContractCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<Contract> {
    const row = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.contract.create({
        data: {
          tenantId,
          ...input,
          startDate: new Date(input.startDate),
          endDate: input.endDate ? new Date(input.endDate) : null,
          createdById: actor.userId,
          createdByEmail: actor.email,
        },
      }),
    ).catch((error: unknown) => {
      throw isUniqueViolation(error)
        ? new ConflictException('Un contrat porte déjà cette référence.')
        : error;
    });
    await this.record('contract.created', tenantId, 'contract', row.id, actor, context, {
      reference: row.reference,
      customer: row.customerName,
    });
    return this.get(tenantId, row.id);
  }

  async update(
    tenantId: string,
    contractId: string,
    input: ContractUpdateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<Contract> {
    await withTenant(this.appPrisma, tenantId, async (tx) => {
      const found = await tx.contract.findFirst({ where: { id: contractId, tenantId } });
      if (!found) throw new NotFoundException('Contrat introuvable.');
      const start = input.startDate ? new Date(input.startDate) : found.startDate;
      const end =
        input.endDate === undefined
          ? found.endDate
          : input.endDate
            ? new Date(input.endDate)
            : null;
      if (end && end < start) throw new BadRequestException('La fin précède le début.');
      await tx.contract.update({
        where: { id: contractId },
        data: {
          ...input,
          ...(input.startDate ? { startDate: start } : {}),
          ...(input.endDate !== undefined ? { endDate: end } : {}),
        },
      });
    }).catch((error: unknown) => {
      throw isUniqueViolation(error)
        ? new ConflictException('Un contrat porte déjà cette référence.')
        : error;
    });
    await this.record('contract.updated', tenantId, 'contract', contractId, actor, context, {
      ...input,
    });
    return this.get(tenantId, contractId);
  }

  /** Machines couvertes : la liste remplace la précédente ; une machine n'a qu'un contrat. */
  async setPrinters(
    tenantId: string,
    contractId: string,
    input: ContractPrintersInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<Contract> {
    await withTenant(this.appPrisma, tenantId, async (tx) => {
      const found = await tx.contract.findFirst({ where: { id: contractId, tenantId } });
      if (!found) throw new NotFoundException('Contrat introuvable.');
      const ids = [...new Set(input.printerIds)];
      const printers = await tx.printer.findMany({
        where: { tenantId, id: { in: ids } },
        select: { id: true },
      });
      if (printers.length !== ids.length) {
        throw new BadRequestException('Machine introuvable dans cette entreprise.');
      }
      const taken = await tx.contractPrinter.findMany({
        where: { tenantId, printerId: { in: ids }, contractId: { not: contractId } },
        include: { printer: { select: { name: true } }, contract: { select: { reference: true } } },
      });
      if (taken.length) {
        throw new ConflictException(
          `Déjà sous contrat : ${taken.map((item) => `${item.printer.name} (${item.contract.reference})`).join(', ')}.`,
        );
      }
      await tx.contractPrinter.deleteMany({ where: { contractId, printerId: { notIn: ids } } });
      const existing = await tx.contractPrinter.findMany({
        where: { contractId },
        select: { printerId: true },
      });
      const current = new Set(existing.map((item) => item.printerId));
      const added = ids.filter((id) => !current.has(id));
      if (added.length) {
        await tx.contractPrinter.createMany({
          data: added.map((printerId) => ({ contractId, printerId, tenantId })),
        });
      }
    });
    await this.record(
      'contract.printers_updated',
      tenantId,
      'contract',
      contractId,
      actor,
      context,
      {
        printers: input.printerIds.length,
      },
    );
    return this.get(tenantId, contractId);
  }

  async invoices(tenantId: string, query: InvoiceListQuery): Promise<Page<Invoice>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const where: Prisma.InvoiceWhereInput = {
        tenantId,
        ...(query.contractId ? { contractId: query.contractId } : {}),
      };
      const total = await tx.invoice.count({ where });
      const rows = await tx.invoice.findMany({
        where,
        include: invoiceInclude,
        orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return { items: rows.map(toInvoice), total, page: query.page, pageSize: query.pageSize };
    });
  }

  async invoice(tenantId: string, invoiceId: string): Promise<Invoice> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const row = await tx.invoice.findFirst({
        where: { id: invoiceId, tenantId },
        include: invoiceInclude,
      });
      if (!row) throw new NotFoundException('Relevé introuvable.');
      return toInvoice(row);
    });
  }

  /**
   * Établit un relevé brouillon : pages relevées de chaque machine du contrat sur la période
   * (réparties entre relevés de compteurs), forfait et pages supplémentaires, et coût de revient.
   */
  async createInvoice(
    tenantId: string,
    contractId: string,
    input: InvoiceCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<Invoice> {
    const contract = await this.get(tenantId, contractId);
    if (!contract.printers.length) {
      throw new BadRequestException('Ce contrat ne couvre encore aucune machine.');
    }
    if (
      input.periodStart < contract.startDate ||
      (contract.endDate && input.periodEnd > contract.endDate)
    ) {
      throw new BadRequestException('La période sort des dates du contrat.');
    }
    const printerIds = contract.printers.map((printer) => printer.id);
    const fleet = await this.consumption.fleetConsumption(tenantId, {
      from: input.periodStart,
      to: input.periodEnd,
    });
    const lines: InvoiceLine[] = contract.printers.map((printer) => {
      const pages = fleet.printers.find((item) => item.printerId === printer.id)?.pages;
      const total = Math.round(pages?.total ?? 0);
      const color = Math.round(pages?.color ?? 0);
      return {
        printerId: printer.id,
        name: printer.name,
        serialNumber: printer.serialNumber,
        blackPages: total - color,
        colorPages: color,
        coverage: pages?.coverage ?? 0,
      };
    });
    const billing = bill(
      contract,
      lines.reduce((sum, line) => sum + line.blackPages, 0),
      lines.reduce((sum, line) => sum + line.colorPages, 0),
    );
    const report = await this.costs.report(
      tenantId,
      { from: input.periodStart, to: input.periodEnd },
      printerIds,
    );
    const row = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.invoice.create({
        data: {
          tenantId,
          contractId,
          periodStart: new Date(input.periodStart),
          periodEnd: new Date(input.periodEnd),
          ...billing,
          includedBlackPages: contract.includedBlackPages,
          includedColorPages: contract.includedColorPages,
          fixedFee: contract.fixedFee,
          blackPagePrice: contract.blackPagePrice,
          colorPagePrice: contract.colorPagePrice,
          cost: report.totals.total,
          currency: contract.currency,
          lines: lines as unknown as Prisma.InputJsonValue,
          createdById: actor.userId,
          createdByEmail: actor.email,
        },
        include: invoiceInclude,
      }),
    );
    await this.record('invoice.drafted', tenantId, 'invoice', row.id, actor, context, {
      contract: contract.reference,
      period: `${input.periodStart} → ${input.periodEnd}`,
      total: billing.totalAmount,
    });
    return toInvoice(row);
  }

  /** Émet un relevé : il reçoit son numéro, dans l'ordre, et ne se modifie plus. */
  async issue(
    tenantId: string,
    invoiceId: string,
    actor: Principal,
    context: RequestContext,
  ): Promise<Invoice> {
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const draft = await tx.invoice.findFirst({ where: { id: invoiceId, tenantId } });
      if (!draft) throw new NotFoundException('Relevé introuvable.');
      if (draft.status !== 'DRAFT')
        throw new BadRequestException('Ce relevé est déjà émis ou annulé.');
      const year = new Date().getFullYear();
      const sequence = await nextNumber(tx, tenantId, `invoice-${year}`);
      return tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'ISSUED', number: invoiceNumber(year, sequence), issuedAt: new Date() },
        include: invoiceInclude,
      });
    });
    await this.record('invoice.issued', tenantId, 'invoice', invoiceId, actor, context, {
      number: row.number,
      total: Number(row.totalAmount),
    });
    return toInvoice(row);
  }

  /** Annule un relevé émis (il garde son numéro), ou supprime un brouillon. */
  async cancel(
    tenantId: string,
    invoiceId: string,
    actor: Principal,
    context: RequestContext,
  ): Promise<void> {
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const found = await tx.invoice.findFirst({ where: { id: invoiceId, tenantId } });
      if (!found) throw new NotFoundException('Relevé introuvable.');
      if (found.status === 'CANCELLED') throw new BadRequestException('Ce relevé est déjà annulé.');
      if (found.status === 'DRAFT') {
        await tx.invoice.delete({ where: { id: invoiceId } });
      } else {
        await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELLED' } });
      }
      return found;
    });
    await this.record(
      row.status === 'DRAFT' ? 'invoice.draft_deleted' : 'invoice.cancelled',
      tenantId,
      'invoice',
      invoiceId,
      actor,
      context,
      { number: row.number },
    );
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

function toContract(row: ContractRow, currency: string): Contract {
  const last = row.invoices[0];
  return {
    id: row.id,
    reference: row.reference,
    customerName: row.customerName,
    customerContact: row.customerContact,
    status: row.status,
    startDate: day(row.startDate),
    endDate: row.endDate ? day(row.endDate) : null,
    billingPeriod: row.billingPeriod,
    fixedFee: Number(row.fixedFee),
    includedBlackPages: row.includedBlackPages,
    includedColorPages: row.includedColorPages,
    blackPagePrice: Number(row.blackPagePrice),
    colorPagePrice: Number(row.colorPagePrice),
    currency,
    notes: row.notes,
    printers: row.printers
      .map((item) => ({
        id: item.printer.id,
        name: item.printer.name,
        serialNumber: item.printer.serialNumber,
        siteName: item.printer.site.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    lastInvoice: last
      ? { id: last.id, number: last.number, periodEnd: day(last.periodEnd), status: last.status }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toInvoice(row: InvoiceRow): Invoice {
  const total = Number(row.totalAmount);
  const cost = row.cost === null ? null : Number(row.cost);
  return {
    id: row.id,
    contract: row.contract,
    number: row.number,
    status: row.status,
    periodStart: day(row.periodStart),
    periodEnd: day(row.periodEnd),
    blackPages: row.blackPages,
    colorPages: row.colorPages,
    includedBlackPages: row.includedBlackPages,
    includedColorPages: row.includedColorPages,
    extraBlackPages: row.extraBlackPages,
    extraColorPages: row.extraColorPages,
    fixedFee: Number(row.fixedFee),
    blackPagePrice: Number(row.blackPagePrice),
    colorPagePrice: Number(row.colorPagePrice),
    extraBlackAmount: Number(row.extraBlackAmount),
    extraColorAmount: Number(row.extraColorAmount),
    totalAmount: total,
    cost,
    margin: cost === null ? null : Math.round((total - cost) * 100) / 100,
    currency: row.currency,
    lines: row.lines as unknown as InvoiceLine[],
    issuedAt: row.issuedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdByEmail: row.createdByEmail,
  };
}
