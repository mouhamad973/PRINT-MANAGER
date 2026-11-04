import { Prisma, withTenant, type PrismaClient, type TransactionClient } from '@arksen/database';
import type { Page, Printer, PrinterConnection, PrinterDetail } from '@arksen/shared-types';
import type {
  PrinterConnectionInput,
  PrinterCreateInput,
  PrinterListQuery,
  PrinterUpdateInput,
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
import { diffChanges, isUniqueViolation } from '../common/changes.js';
import { SECRET_BOX, SecretBox } from '../common/secret-box.js';
import { PRISMA_APP } from '../database/database.module.js';

const printerInclude = {
  site: { select: { id: true, name: true } },
  model: {
    select: {
      id: true,
      manufacturer: true,
      name: true,
      colorMode: true,
      maxFormat: true,
      tenantId: true,
    },
  },
  connection: true,
} satisfies Prisma.PrinterInclude;
type PrinterRow = Prisma.PrinterGetPayload<{ include: typeof printerInclude }>;
type ConnectionRow = NonNullable<PrinterRow['connection']>;

function toConnection(row: ConnectionRow): PrinterConnection {
  return {
    ipAddress: row.ipAddress,
    hostname: row.hostname,
    macAddress: row.macAddress,
    snmpVersion: row.snmpVersion,
    snmpPort: row.snmpPort,
    hasCommunity: row.snmpCommunity !== null,
    snmpUsername: row.snmpUsername,
    snmpSecurityLevel: row.snmpSecurityLevel,
    snmpAuthProtocol: row.snmpAuthProtocol,
    hasAuthPassword: row.snmpAuthPassword !== null,
    snmpPrivProtocol: row.snmpPrivProtocol,
    hasPrivPassword: row.snmpPrivPassword !== null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPrinter(row: PrinterRow): Printer {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    serialNumber: row.serialNumber,
    assetTag: row.assetTag,
    location: row.location,
    status: row.status,
    connectivity: row.connectivity,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    installedAt: row.installedAt?.toISOString().slice(0, 10) ?? null,
    notes: row.notes,
    site: row.site,
    model: row.model,
    address: row.connection?.ipAddress ?? row.connection?.hostname ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: PrinterRow): PrinterDetail {
  return { ...toPrinter(row), connection: row.connection ? toConnection(row.connection) : null };
}

const DUPLICATE_SERIAL = 'Une machine de cette entreprise porte déjà ce numéro de série.';

type SecretField = 'snmpCommunity' | 'snmpAuthPassword' | 'snmpPrivPassword';

const SECRET_LABELS: Record<SecretField, string> = {
  snmpCommunity: 'la communauté SNMP',
  snmpAuthPassword: 'le mot de passe d’authentification',
  snmpPrivPassword: 'le mot de passe de chiffrement',
};

/**
 * Parc machines d'une entreprise, sous Row-Level Security.
 * Le site et le modèle sont vérifiés dans la même transaction : ceux d'une autre entreprise
 * sont invisibles, et la base refuse de toute façon le lien (clé composite et déclencheur).
 */
@Injectable()
export class PrintersService {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    @Inject(SECRET_BOX) private readonly secrets: SecretBox,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, query: PrinterListQuery): Promise<Page<Printer>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const where: Prisma.PrinterWhereInput = {
        tenantId,
        // Les machines retirées n'apparaissent que si on les demande.
        status: query.status ?? { not: 'RETIRED' },
        ...(query.siteId ? { siteId: query.siteId } : {}),
        ...(query.modelId ? { modelId: query.modelId } : {}),
        ...(query.colorMode ? { model: { colorMode: query.colorMode } } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { serialNumber: { contains: query.search, mode: 'insensitive' } },
                { assetTag: { contains: query.search, mode: 'insensitive' } },
                { location: { contains: query.search, mode: 'insensitive' } },
                { connection: { ipAddress: { contains: query.search } } },
                { connection: { hostname: { contains: query.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.printer.findMany({
          where,
          include: printerInclude,
          orderBy: [{ site: { name: 'asc' } }, { name: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.printer.count({ where }),
      ]);
      return { items: rows.map(toPrinter), total, page: query.page, pageSize: query.pageSize };
    });
  }

  async get(tenantId: string, printerId: string): Promise<PrinterDetail> {
    const row = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.printer.findFirst({ where: { id: printerId, tenantId }, include: printerInclude }),
    );
    if (!row) {
      throw new NotFoundException('Machine introuvable.');
    }
    return toDetail(row);
  }

  async create(
    tenantId: string,
    input: PrinterCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<PrinterDetail> {
    const printer = await withTenant(this.appPrisma, tenantId, async (tx) => {
      await assertReferences(tx, tenantId, input);
      return tx.printer.create({
        data: { ...input, installedAt: toDate(input.installedAt), tenantId },
        include: printerInclude,
      });
    }).catch(rethrowDuplicate);
    await this.record('printer.created', tenantId, printer, actor, context, {
      serialNumber: printer.serialNumber,
      site: printer.site.name,
    });
    return toDetail(printer);
  }

  async update(
    tenantId: string,
    printerId: string,
    input: PrinterUpdateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<PrinterDetail> {
    const { before, after } = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const current = await tx.printer.findFirst({ where: { id: printerId, tenantId } });
      if (!current) {
        throw new NotFoundException('Machine introuvable.');
      }
      await assertReferences(tx, tenantId, input);
      const { installedAt, ...rest } = input;
      const updated = await tx.printer.update({
        where: { id: printerId },
        data: {
          ...rest,
          ...(installedAt !== undefined ? { installedAt: toDate(installedAt) } : {}),
        },
        include: printerInclude,
      });
      return { before: current, after: updated };
    }).catch(rethrowDuplicate);
    const changes = diffChanges(Object.keys(input), before, after);
    await this.record(
      changes.status ? 'printer.status_changed' : 'printer.updated',
      tenantId,
      after,
      actor,
      context,
      { changes },
    );
    return toDetail(after);
  }

  /**
   * Enregistre la configuration réseau. Les secrets suivent la règle de l'écriture seule :
   * absent, conservé ; `null`, effacé ; renseigné, chiffré puis remplacé. Ils ne quittent jamais l'API.
   */
  async setConnection(
    tenantId: string,
    printerId: string,
    input: PrinterConnectionInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<PrinterDetail> {
    const { printer, changedSecrets } = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const current = await tx.printer.findFirst({
        where: { id: printerId, tenantId },
        include: { connection: true },
      });
      if (!current) {
        throw new NotFoundException('Machine introuvable.');
      }
      const previous = current.connection;
      const changed: SecretField[] = [];

      /** Valeur chiffrée à enregistrer pour un secret, ou `null` s'il ne s'applique pas. */
      const secret = (field: SecretField, applies: boolean): string | null => {
        const value = input[field];
        const stored = previous?.[field] ?? null;
        if (!applies) {
          if (stored !== null) changed.push(field);
          return null;
        }
        if (typeof value === 'string') {
          changed.push(field);
          return this.secrets.encrypt(value, `printer:${printerId}:${field}`);
        }
        if (value === null || stored === null) {
          throw new BadRequestException(`Saisissez ${SECRET_LABELS[field]}.`);
        }
        return stored;
      };

      const v3 = input.snmpVersion === 'V3';
      const level = v3 ? (input.snmpSecurityLevel ?? null) : null;
      const auth = level === 'AUTH_NO_PRIV' || level === 'AUTH_PRIV';
      const priv = level === 'AUTH_PRIV';
      const data = {
        ipAddress: input.ipAddress,
        hostname: input.hostname,
        macAddress: input.macAddress,
        snmpVersion: input.snmpVersion,
        snmpPort: input.snmpPort,
        snmpCommunity: secret('snmpCommunity', !v3),
        snmpUsername: v3 ? input.snmpUsername : null,
        snmpSecurityLevel: level,
        snmpAuthProtocol: auth ? (input.snmpAuthProtocol ?? null) : null,
        snmpAuthPassword: secret('snmpAuthPassword', auth),
        snmpPrivProtocol: priv ? (input.snmpPrivProtocol ?? null) : null,
        snmpPrivPassword: secret('snmpPrivPassword', priv),
      };
      await tx.printerConnection.upsert({
        where: { printerId },
        create: { ...data, printerId, tenantId },
        update: data,
      });
      const updated = await tx.printer.findFirstOrThrow({
        where: { id: printerId },
        include: printerInclude,
      });
      return { printer: updated, changedSecrets: changed };
    });
    // Le journal indique quels secrets ont changé, jamais leur valeur.
    await this.record('printer.network_updated', tenantId, printer, actor, context, {
      ipAddress: input.ipAddress,
      hostname: input.hostname,
      snmpVersion: input.snmpVersion,
      changedSecrets,
    });
    return toDetail(printer);
  }

  async clearConnection(
    tenantId: string,
    printerId: string,
    actor: Principal,
    context: RequestContext,
  ): Promise<PrinterDetail> {
    const printer = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const current = await tx.printer.findFirst({ where: { id: printerId, tenantId } });
      if (!current) {
        throw new NotFoundException('Machine introuvable.');
      }
      await tx.printerConnection.deleteMany({ where: { printerId } });
      return tx.printer.findFirstOrThrow({ where: { id: printerId }, include: printerInclude });
    });
    await this.record('printer.network_cleared', tenantId, printer, actor, context);
    return toDetail(printer);
  }

  private async record(
    action: string,
    tenantId: string,
    printer: { id: string; name: string },
    actor: Principal,
    context: RequestContext,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.audit.record({
      action,
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'printer',
      targetId: printer.id,
      metadata: { name: printer.name, ...extra },
      ...context,
    });
  }
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function rethrowDuplicate(error: unknown): never {
  throw isUniqueViolation(error) ? new ConflictException(DUPLICATE_SERIAL) : error;
}

/** Le site doit appartenir à l'entreprise, et le modèle au catalogue Arksen ou à l'entreprise. */
async function assertReferences(
  tx: TransactionClient,
  tenantId: string,
  input: { siteId?: string; modelId?: string },
): Promise<void> {
  if (input.siteId) {
    const site = await tx.site.findFirst({
      where: { id: input.siteId, tenantId },
      select: { id: true },
    });
    if (!site) {
      throw new BadRequestException('Site introuvable dans cette entreprise.');
    }
  }
  if (input.modelId) {
    const model = await tx.printerModel.findFirst({
      where: { id: input.modelId, OR: [{ tenantId: null }, { tenantId }] },
      select: { id: true },
    });
    if (!model) {
      throw new BadRequestException('Fiche technique introuvable.');
    }
  }
}
