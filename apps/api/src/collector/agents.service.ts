import { Prisma, withTenant, type PrismaClient } from '@arksen/database';
import {
  AGENT_ONLINE_WINDOW_MS,
  CMYK_CHANNELS,
  ENROLLMENT_CODE_TTL_MS,
  type AgentEnrollmentCode,
  type AgentStatus,
  type AgentSyncLog,
  type CollectorAgent,
  type DeviceStatus,
  type DiscoveredDevice,
  type Page,
  type PrinterActivity,
  type PrinterAlert,
  type PrinterSnmpState,
  type RejectedAgentEvent,
  type SupplyLevel,
} from '@arksen/shared-types';
import type {
  AgentCreateInput,
  AgentUpdateInput,
  DiscoveredDeviceUpdateInput,
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
import { PRISMA_APP } from '../database/database.module.js';
import { levelTrend } from '../stocks/forecast.js';
import { formatEnrollmentCode, generateEnrollmentCode, hashSecret } from './agent-credentials.js';

const agentInclude = { site: { select: { id: true, name: true } } } as const;
type AgentRow = Prisma.CollectorAgentGetPayload<{ include: typeof agentInclude }>;

const DAY_MS = 24 * 60 * 60 * 1000;

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

@Injectable()
export class AgentsService {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<CollectorAgent[]> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const rows = await tx.collectorAgent.findMany({
        where: { tenantId },
        include: agentInclude,
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
      });
      const counts = await tx.agentEvent.groupBy({
        by: ['agentId', 'status'],
        where: { tenantId, receivedAt: { gte: new Date(Date.now() - DAY_MS) } },
        _count: { _all: true },
      });
      return rows.map((row) => {
        const own = counts.filter((count) => count.agentId === row.id);
        const total = own.reduce((sum, count) => sum + count._count._all, 0);
        const rejected = own.find((count) => count.status === 'REJECTED')?._count._all ?? 0;
        return toAgent(row, total, rejected);
      });
    });
  }

  async create(
    tenantId: string,
    input: AgentCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<AgentEnrollmentCode> {
    const code = generateEnrollmentCode();
    const expiresAt = new Date(Date.now() + ENROLLMENT_CODE_TTL_MS);
    const row = await withTenant(this.appPrisma, tenantId, (tx) =>
      tx.collectorAgent.create({
        data: {
          tenantId,
          name: input.name,
          siteId: input.siteId,
          enrollmentCodeHash: hashSecret(code),
          enrollmentExpiresAt: expiresAt,
          createdById: actor.userId,
          createdByEmail: actor.email,
        },
        include: agentInclude,
      }),
    ).catch((error: unknown) => {
      throw this.translate(error);
    });
    await this.record('agent.created', tenantId, row, actor, context);
    return {
      agent: toAgent(row, 0, 0),
      enrollmentCode: formatEnrollmentCode(code),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async update(
    tenantId: string,
    agentId: string,
    input: AgentUpdateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<CollectorAgent> {
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      await this.find(tx, tenantId, agentId);
      return tx.collectorAgent.update({
        where: { id: agentId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.siteId !== undefined ? { siteId: input.siteId } : {}),
        },
        include: agentInclude,
      });
    }).catch((error: unknown) => {
      throw this.translate(error);
    });
    await this.record('agent.updated', tenantId, row, actor, context, {
      name: row.name,
      site: row.site?.name ?? null,
    });
    return toAgent(row, 0, 0);
  }

  /**
   * Nouveau code d'enregistrement : pour un agent jamais enregistré, réinstallé ou révoqué.
   * L'ancien jeton reste valable jusqu'à ce que le nouveau code soit utilisé.
   */
  async renewCode(
    tenantId: string,
    agentId: string,
    actor: Principal,
    context: RequestContext,
  ): Promise<AgentEnrollmentCode> {
    const code = generateEnrollmentCode();
    const expiresAt = new Date(Date.now() + ENROLLMENT_CODE_TTL_MS);
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const agent = await this.find(tx, tenantId, agentId);
      return tx.collectorAgent.update({
        where: { id: agentId },
        data: {
          enrollmentCodeHash: hashSecret(code),
          enrollmentExpiresAt: expiresAt,
          ...(agent.status === 'REVOKED' ? { status: 'PENDING', revokedAt: null } : {}),
        },
        include: agentInclude,
      });
    });
    await this.record('agent.code_renewed', tenantId, row, actor, context);
    return {
      agent: toAgent(row, 0, 0),
      enrollmentCode: formatEnrollmentCode(code),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Révocation immédiate : le jeton et tout code en attente sont effacés. */
  async revoke(
    tenantId: string,
    agentId: string,
    actor: Principal,
    context: RequestContext,
  ): Promise<CollectorAgent> {
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      await this.find(tx, tenantId, agentId);
      return tx.collectorAgent.update({
        where: { id: agentId },
        data: {
          status: 'REVOKED',
          tokenHash: null,
          enrollmentCodeHash: null,
          enrollmentExpiresAt: null,
          revokedAt: new Date(),
        },
        include: agentInclude,
      });
    });
    await this.record('agent.revoked', tenantId, row, actor, context);
    return toAgent(row, 0, 0);
  }

  async syncLogs(
    tenantId: string,
    query: ListQuery & { agentId?: string },
  ): Promise<Page<AgentSyncLog>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const where = { tenantId, ...(query.agentId ? { agentId: query.agentId } : {}) };
      const total = await tx.agentSyncLog.count({ where });
      const rows = await tx.agentSyncLog.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { agent: { select: { name: true } } },
      });
      return {
        items: rows.map((row) => ({
          id: row.id,
          agentId: row.agentId,
          agentName: row.agent.name,
          receivedAt: row.receivedAt.toISOString(),
          received: row.received,
          accepted: row.accepted,
          duplicates: row.duplicates,
          rejected: row.rejected,
          durationMs: row.durationMs,
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async rejectedEvents(tenantId: string, query: ListQuery): Promise<Page<RejectedAgentEvent>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const where = { tenantId, status: 'REJECTED' as const };
      const total = await tx.agentEvent.count({ where });
      const rows = await tx.agentEvent.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { agent: { select: { name: true } } },
      });
      const printerIds = [
        ...new Set(rows.flatMap((row) => (row.printerId ? [row.printerId] : []))),
      ];
      const printers = printerIds.length
        ? await tx.printer.findMany({
            where: { tenantId, id: { in: printerIds } },
            select: { id: true, name: true },
          })
        : [];
      const names = new Map(printers.map((printer) => [printer.id, printer.name]));
      return {
        items: rows.map((row) => ({
          id: row.id,
          agentId: row.agentId,
          agentName: row.agent.name,
          type: row.type,
          printerId: row.printerId,
          printerName: row.printerId ? (names.get(row.printerId) ?? null) : null,
          occurredAt: row.occurredAt.toISOString(),
          receivedAt: row.receivedAt.toISOString(),
          error: row.error ?? '',
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async discoveredDevices(tenantId: string, query: ListQuery): Promise<Page<DiscoveredDevice>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const search = query.search?.trim();
      const where: Prisma.DiscoveredDeviceWhereInput = {
        tenantId,
        ...(search
          ? {
              OR: [
                { ipAddress: { contains: search } },
                { serialNumber: { contains: search, mode: 'insensitive' } },
                { sysName: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const total = await tx.discoveredDevice.count({ where });
      const rows = await tx.discoveredDevice.findMany({
        where,
        // Les équipements à traiter d'abord : non rattachés et non ignorés.
        orderBy: [
          { ignored: 'asc' },
          { printerId: { sort: 'asc', nulls: 'first' } },
          { ipAddress: 'asc' },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          agent: { select: { name: true } },
          printer: { select: { id: true, name: true } },
        },
      });
      return {
        items: rows.map(toDevice),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  /**
   * Rattache un équipement découvert à une machine, ou l'ignore. Une machine sans adresse
   * réseau reçoit celle de l'équipement : l'agent l'interrogera dès sa prochaine configuration.
   */
  async updateDevice(
    tenantId: string,
    deviceId: string,
    input: DiscoveredDeviceUpdateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<DiscoveredDevice> {
    const { row, addressed } = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const device = await tx.discoveredDevice.findFirst({ where: { id: deviceId, tenantId } });
      if (!device) throw new NotFoundException('Équipement introuvable.');
      let addressed = false;
      if (input.printerId) {
        const printer = await tx.printer.findFirst({
          where: { id: input.printerId, tenantId },
          select: { id: true, connection: { select: { ipAddress: true, hostname: true } } },
        });
        if (!printer) throw new BadRequestException('Machine introuvable dans cette entreprise.');
        if (!printer.connection) {
          await tx.printerConnection.create({
            data: { printerId: printer.id, tenantId, ipAddress: device.ipAddress },
          });
          addressed = true;
        } else if (!printer.connection.ipAddress && !printer.connection.hostname) {
          await tx.printerConnection.update({
            where: { printerId: printer.id },
            data: { ipAddress: device.ipAddress },
          });
          addressed = true;
        }
      }
      const row = await tx.discoveredDevice.update({
        where: { id: deviceId },
        data: {
          ...(input.printerId !== undefined ? { printerId: input.printerId } : {}),
          ...(input.ignored !== undefined ? { ignored: input.ignored } : {}),
        },
        include: {
          agent: { select: { name: true } },
          printer: { select: { id: true, name: true } },
        },
      });
      return { row, addressed };
    });
    await this.audit.record({
      action: 'discovered_device.updated',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'discovered_device',
      targetId: deviceId,
      metadata: {
        ipAddress: row.ipAddress,
        printer: row.printer?.name ?? null,
        ignored: row.ignored,
        addressAssigned: addressed,
      },
      ...context,
    });
    return toDevice(row);
  }

  async printerState(tenantId: string, printerId: string): Promise<PrinterSnmpState | null> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const printer = await tx.printer.findFirst({
        where: { id: printerId, tenantId },
        select: { id: true },
      });
      if (!printer) throw new NotFoundException('Machine introuvable.');
      const row = await tx.printerState.findUnique({
        where: { printerId },
        include: { agent: { select: { id: true, name: true } } },
      });
      if (!row) return null;
      // Épuisement prévu : tendance des niveaux des 60 derniers jours, depuis le dernier remplacement.
      const history = await tx.supplyLevelReading.findMany({
        where: { printerId, observedAt: { gte: new Date(Date.now() - 60 * DAY_MS) } },
        orderBy: { observedAt: 'asc' },
      });
      const now = new Date();
      const forecasts = CMYK_CHANNELS.flatMap((channel) => {
        const points = history
          .filter((point) => point.channel === channel)
          .map((point) => ({ at: point.observedAt, level: Number(point.levelPercent) }));
        const current = points.at(-1);
        if (!current) return [];
        const trend = levelTrend(points, now);
        return [
          {
            channel,
            levelPercent: current.level,
            percentPerDay: trend.percentPerDay,
            emptyAt: trend.emptyAt?.toISOString() ?? null,
          },
        ];
      });
      return {
        printerId: row.printerId,
        agent: row.agent,
        observedAt: row.observedAt.toISOString(),
        reachable: row.reachable,
        error: row.error,
        deviceStatus: row.deviceStatus as DeviceStatus | null,
        printerStatus: row.printerStatus as PrinterActivity | null,
        alerts: row.alerts as PrinterAlert[],
        supplies: row.supplies as unknown as SupplyLevel[],
        totalCount: row.totalCount,
        serialNumber: row.serialNumber,
        description: row.description,
        forecasts,
      };
    });
  }

  private async find(tx: Prisma.TransactionClient, tenantId: string, agentId: string) {
    const agent = await tx.collectorAgent.findFirst({
      where: { id: agentId, tenantId },
      select: { id: true, status: true },
    });
    if (!agent) throw new NotFoundException('Agent introuvable.');
    return agent;
  }

  private translate(error: unknown): unknown {
    if (isUniqueViolation(error)) return new ConflictException('Un agent porte déjà ce nom.');
    if (isForeignKeyViolation(error)) {
      return new BadRequestException('Site introuvable dans cette entreprise.');
    }
    return error;
  }

  private async record(
    action: string,
    tenantId: string,
    row: AgentRow,
    actor: Principal,
    context: RequestContext,
    metadata: Record<string, unknown> = { name: row.name },
  ) {
    await this.audit.record({
      action,
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'agent',
      targetId: row.id,
      metadata,
      ...context,
    });
  }
}

function toAgent(row: AgentRow, events24h: number, rejected24h: number): CollectorAgent {
  const pendingCode =
    row.enrollmentCodeHash && row.enrollmentExpiresAt && row.enrollmentExpiresAt > new Date();
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    site: row.site,
    status: row.status as AgentStatus,
    enrollmentExpiresAt: pendingCode ? row.enrollmentExpiresAt!.toISOString() : null,
    hostname: row.hostname,
    version: row.version,
    platform: row.platform,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    online:
      row.status === 'ACTIVE' &&
      row.lastSeenAt !== null &&
      Date.now() - row.lastSeenAt.getTime() < AGENT_ONLINE_WINDOW_MS,
    events24h,
    rejected24h,
    enrolledAt: row.enrolledAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdByEmail: row.createdByEmail,
    createdAt: row.createdAt.toISOString(),
  };
}

type DeviceRow = Prisma.DiscoveredDeviceGetPayload<{
  include: { agent: { select: { name: true } }; printer: { select: { id: true; name: true } } };
}>;

function toDevice(row: DeviceRow): DiscoveredDevice {
  return {
    id: row.id,
    agentId: row.agentId,
    agentName: row.agent.name,
    ipAddress: row.ipAddress,
    serialNumber: row.serialNumber,
    sysName: row.sysName,
    description: row.description,
    macAddress: row.macAddress,
    printer: row.printer,
    ignored: row.ignored,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}
