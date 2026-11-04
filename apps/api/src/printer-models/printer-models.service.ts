import { Prisma, withTenant, type PrismaClient, type TransactionClient } from '@arksen/database';
import type { Page, PrinterModel } from '@arksen/shared-types';
import type {
  PrinterModelCreateInput,
  PrinterModelListQuery,
  PrinterModelUpdateInput,
} from '@arksen/validation';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Principal, RequestContext } from '../auth/principal.js';
import { diffChanges } from '../common/changes.js';
import { PRISMA_APP, PRISMA_SYSTEM } from '../database/database.module.js';

const modelInclude = {
  _count: { select: { printers: true } },
} satisfies Prisma.PrinterModelInclude;
type ModelRow = Prisma.PrinterModelGetPayload<{ include: typeof modelInclude }>;

export function toPrinterModel({ _count, ...row }: ModelRow): PrinterModel {
  return {
    ...row,
    printerCount: _count.printers,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function searchWhere(query: PrinterModelListQuery): Prisma.PrinterModelWhereInput {
  return {
    ...(query.colorMode ? { colorMode: query.colorMode } : {}),
    ...(query.search
      ? {
          OR: [
            { manufacturer: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

type Db = TransactionClient | PrismaClient;

/**
 * Refuse un doublon (fabricant et nom, sans tenir compte de la casse) parmi les fiches visibles :
 * le catalogue Arksen et, pour une entreprise, ses propres fiches.
 */
async function assertUnique(
  db: Db,
  tenantId: string | null,
  input: { manufacturer?: string; name?: string },
  current?: { id: string; manufacturer: string; name: string },
): Promise<void> {
  const manufacturer = input.manufacturer ?? current?.manufacturer;
  const name = input.name ?? current?.name;
  if (!manufacturer || !name) {
    return;
  }
  const duplicate = await db.printerModel.findFirst({
    where: {
      manufacturer: { equals: manufacturer, mode: 'insensitive' },
      name: { equals: name, mode: 'insensitive' },
      OR: tenantId ? [{ tenantId: null }, { tenantId }] : [{ tenantId: null }],
      ...(current ? { NOT: { id: current.id } } : {}),
    },
    select: { tenantId: true },
  });
  if (duplicate) {
    throw new ConflictException(
      duplicate.tenantId
        ? 'Votre entreprise a déjà une fiche pour ce modèle.'
        : 'Ce modèle existe déjà dans le catalogue Arksen.',
    );
  }
}

/**
 * Fiches techniques. Le catalogue Arksen (`tenantId` nul) passe par le rôle de plateforme ;
 * les fiches d'une entreprise passent par le rôle soumis au RLS, qui lui laisse lire le catalogue
 * sans jamais pouvoir le modifier.
 */
@Injectable()
export class PrinterModelsService {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    @Inject(PRISMA_SYSTEM) private readonly systemPrisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  /** Catalogue Arksen et fiches de l'entreprise. Les compteurs de machines ne portent que sur ses machines. */
  listForTenant(tenantId: string, query: PrinterModelListQuery): Promise<Page<PrinterModel>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const scope: Prisma.PrinterModelWhereInput =
        query.scope === 'catalog'
          ? { tenantId: null }
          : query.scope === 'tenant'
            ? { tenantId }
            : { OR: [{ tenantId: null }, { tenantId }] };
      const where = { AND: [scope, searchWhere(query)] };
      return this.page(tx, where, query);
    });
  }

  /** Catalogue Arksen seul, pour la plateforme : les compteurs portent sur toutes les entreprises. */
  listCatalog(query: PrinterModelListQuery): Promise<Page<PrinterModel>> {
    return this.page(this.systemPrisma, { AND: [{ tenantId: null }, searchWhere(query)] }, query);
  }

  private async page(
    db: Db,
    where: Prisma.PrinterModelWhereInput,
    query: PrinterModelListQuery,
  ): Promise<Page<PrinterModel>> {
    const [rows, total] = await Promise.all([
      db.printerModel.findMany({
        where,
        include: modelInclude,
        orderBy: [{ manufacturer: 'asc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.printerModel.count({ where }),
    ]);
    return { items: rows.map(toPrinterModel), total, page: query.page, pageSize: query.pageSize };
  }

  async getForTenant(tenantId: string, modelId: string): Promise<PrinterModel> {
    const row = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.printerModel.findFirst({
        where: { id: modelId, OR: [{ tenantId: null }, { tenantId }] },
        include: modelInclude,
      }),
    );
    if (!row) {
      throw new NotFoundException('Fiche technique introuvable.');
    }
    return toPrinterModel(row);
  }

  async createForTenant(
    tenantId: string,
    input: PrinterModelCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<PrinterModel> {
    const model = await withTenant(this.appPrisma, tenantId, async (tx) => {
      await assertUnique(tx, tenantId, input);
      return tx.printerModel.create({ data: { ...input, tenantId }, include: modelInclude });
    });
    await this.record('printer_model.created', tenantId, model, actor, context);
    return toPrinterModel(model);
  }

  async createInCatalog(
    input: PrinterModelCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<PrinterModel> {
    await assertUnique(this.systemPrisma, null, input);
    const model = await this.systemPrisma.printerModel.create({
      data: { ...input, tenantId: null },
      include: modelInclude,
    });
    await this.record('printer_model.created', null, model, actor, context);
    return toPrinterModel(model);
  }

  /** Une entreprise ne modifie que ses propres fiches : le catalogue lui répond « introuvable ». */
  async updateForTenant(
    tenantId: string,
    modelId: string,
    input: PrinterModelUpdateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<PrinterModel> {
    const { before, after } = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const current = await tx.printerModel.findFirst({ where: { id: modelId, tenantId } });
      if (!current) {
        throw new NotFoundException('Fiche technique introuvable ou non modifiable.');
      }
      await assertUnique(tx, tenantId, input, current);
      const updated = await tx.printerModel.update({
        where: { id: modelId },
        data: input,
        include: modelInclude,
      });
      return { before: current, after: updated };
    });
    await this.record('printer_model.updated', tenantId, after, actor, context, {
      changes: diffChanges(Object.keys(input), before, after),
    });
    return toPrinterModel(after);
  }

  async updateInCatalog(
    modelId: string,
    input: PrinterModelUpdateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<PrinterModel> {
    const current = await this.systemPrisma.printerModel.findFirst({
      where: { id: modelId, tenantId: null },
    });
    if (!current) {
      throw new NotFoundException('Fiche du catalogue introuvable.');
    }
    await assertUnique(this.systemPrisma, null, input, current);
    const after = await this.systemPrisma.printerModel.update({
      where: { id: modelId },
      data: input,
      include: modelInclude,
    });
    await this.record('printer_model.updated', null, after, actor, context, {
      changes: diffChanges(Object.keys(input), current, after),
    });
    return toPrinterModel(after);
  }

  async removeForTenant(
    tenantId: string,
    modelId: string,
    actor: Principal,
    context: RequestContext,
  ): Promise<void> {
    const model = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const current = await tx.printerModel.findFirst({
        where: { id: modelId, tenantId },
        include: modelInclude,
      });
      if (!current) {
        throw new NotFoundException('Fiche technique introuvable ou non modifiable.');
      }
      assertUnused(current);
      await tx.printerModel.delete({ where: { id: modelId } });
      return current;
    });
    await this.record('printer_model.deleted', tenantId, model, actor, context);
  }

  async removeFromCatalog(
    modelId: string,
    actor: Principal,
    context: RequestContext,
  ): Promise<void> {
    const current = await this.systemPrisma.printerModel.findFirst({
      where: { id: modelId, tenantId: null },
      include: modelInclude,
    });
    if (!current) {
      throw new NotFoundException('Fiche du catalogue introuvable.');
    }
    assertUnused(current);
    await this.systemPrisma.printerModel.delete({ where: { id: modelId } });
    await this.record('printer_model.deleted', null, current, actor, context);
  }

  private async record(
    action: string,
    tenantId: string | null,
    model: { id: string; manufacturer: string; name: string },
    actor: Principal,
    context: RequestContext,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.audit.record({
      action,
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'printer_model',
      targetId: model.id,
      metadata: {
        name: `${model.manufacturer} ${model.name}`,
        scope: tenantId ? 'tenant' : 'catalog',
        ...extra,
      },
      ...context,
    });
  }
}

/** Une fiche utilisée par des machines reste : la supprimer effacerait leurs caractéristiques. */
function assertUnused(model: ModelRow): void {
  const count = model._count.printers;
  if (count > 0) {
    throw new ConflictException(
      `Cette fiche est utilisée par ${count} machine${count > 1 ? 's' : ''} et ne peut pas être supprimée.`,
    );
  }
}
