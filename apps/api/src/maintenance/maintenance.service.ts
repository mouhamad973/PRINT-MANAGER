import { Prisma, withTenant, type PrismaClient, type TransactionClient } from '@arksen/database';
import {
  hasPermission,
  type Assignee,
  type Intervention,
  type MaintenancePlan,
  type Page,
  type UserRole,
} from '@arksen/shared-types';
import type {
  InterventionCreateInput,
  InterventionListQuery,
  InterventionUpdateInput,
  MaintenancePlanCreateInput,
  MaintenancePlanUpdateInput,
} from '@arksen/validation';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AlertsService } from '../alerts/alerts.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { Principal, RequestContext } from '../auth/principal.js';
import { isUniqueViolation } from '../common/changes.js';
import { nextNumber } from '../common/sequence.js';
import { PRISMA_APP } from '../database/database.module.js';
import { planStatus } from './plan-status.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rôles à qui une intervention peut être confiée. */
const ASSIGNABLE_ROLES: UserRole[] = ['CLIENT_ADMIN', 'PRINT_MANAGER', 'TECHNICIAN'];

const interventionInclude = {
  printer: { select: { id: true, name: true, site: { select: { name: true } } } },
  plan: { select: { id: true, name: true } },
} as const;
type InterventionRow = Prisma.InterventionGetPayload<{ include: typeof interventionInclude }>;

const planInclude = {
  printer: { select: { id: true, name: true, site: { select: { name: true } } } },
} as const;
type PlanRow = Prisma.MaintenancePlanGetPayload<{ include: typeof planInclude }>;

@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
  ) {}

  // -- Interventions -------------------------------------------------------------------------

  async list(tenantId: string, query: InterventionListQuery): Promise<Page<Intervention>> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const currency = await this.currency(tx, tenantId);
      const search = query.search?.trim();
      const where: Prisma.InterventionWhereInput = {
        tenantId,
        ...(query.status === 'ACTIVE' || query.status === undefined
          ? { status: { in: ['OPEN', 'SCHEDULED', 'IN_PROGRESS'] } }
          : { status: query.status }),
        ...(query.printerId ? { printerId: query.printerId } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: 'insensitive' } },
                { printer: { name: { contains: search, mode: 'insensitive' } } },
                ...(/^\d+$/.test(search) ? [{ number: Number(search) }] : []),
              ],
            }
          : {}),
      };
      const total = await tx.intervention.count({ where });
      const rows = await tx.intervention.findMany({
        where,
        include: interventionInclude,
        orderBy: [{ priority: 'desc' }, { reportedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return {
        items: rows.map((row) => toIntervention(row, currency)),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async get(tenantId: string, interventionId: string): Promise<Intervention> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const row = await tx.intervention.findFirst({
        where: { id: interventionId, tenantId },
        include: interventionInclude,
      });
      if (!row) throw new NotFoundException('Intervention introuvable.');
      return toIntervention(row, await this.currency(tx, tenantId));
    });
  }

  /** Personnes à qui confier une intervention : administrateurs, responsables, techniciens. */
  async assignees(tenantId: string): Promise<Assignee[]> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const users = await tx.user.findMany({
        where: { tenantId, status: 'ACTIVE', role: { in: ASSIGNABLE_ROLES } },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: 'asc' },
      });
      return users;
    });
  }

  /**
   * Ouvre une intervention. Sans le droit de conduire les interventions, on ne peut que
   * signaler une panne : ni affectation, ni planification, ni maintenance préventive.
   */
  async create(
    tenantId: string,
    input: InterventionCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<Intervention> {
    const manager = hasPermission(actor.role, 'interventions:manage');
    if (
      !manager &&
      (input.type !== 'CORRECTIVE' || input.assigneeId || input.scheduledAt || input.planId)
    ) {
      throw new ForbiddenException(
        'Vous pouvez signaler une panne, pas planifier une intervention.',
      );
    }
    const row = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const printer = await tx.printer.findFirst({ where: { id: input.printerId, tenantId } });
      if (!printer) throw new BadRequestException('Machine introuvable dans cette entreprise.');
      const assignee = input.assigneeId
        ? await this.assignee(tx, tenantId, input.assigneeId)
        : null;
      if (input.planId) {
        const plan = await tx.maintenancePlan.findFirst({
          where: { id: input.planId, tenantId, printerId: input.printerId },
        });
        if (!plan)
          throw new BadRequestException('Ce plan de maintenance concerne une autre machine.');
      }
      const number = await nextNumber(tx, tenantId, 'intervention');
      return tx.intervention.create({
        data: {
          tenantId,
          number,
          printerId: input.printerId,
          type: input.planId ? 'PREVENTIVE' : input.type,
          priority: input.priority,
          title: input.title,
          description: input.description,
          status: input.scheduledAt ? 'SCHEDULED' : 'OPEN',
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          assigneeId: assignee?.id ?? null,
          assigneeName: assignee?.name ?? null,
          planId: input.planId ?? null,
          reportedById: actor.userId,
          reportedByEmail: actor.email,
        },
        include: interventionInclude,
      });
    });
    await this.record('intervention.created', tenantId, row, actor, context, {
      number: row.number,
      title: row.title,
      type: row.type,
    });
    return this.get(tenantId, row.id);
  }

  /** Fait avancer une intervention ; terminée, elle relève le compteur et ses coûts. */
  async update(
    tenantId: string,
    interventionId: string,
    input: InterventionUpdateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<Intervention> {
    const { row, previous } = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const current = await tx.intervention.findFirst({ where: { id: interventionId, tenantId } });
      if (!current) throw new NotFoundException('Intervention introuvable.');
      if (current.status === 'DONE' || current.status === 'CANCELLED') {
        throw new BadRequestException('Cette intervention est close.');
      }
      const data: Prisma.InterventionUncheckedUpdateInput = {
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.laborMinutes !== undefined ? { laborMinutes: input.laborMinutes } : {}),
        ...(input.laborCost !== undefined ? { laborCost: input.laborCost } : {}),
        ...(input.partsCost !== undefined ? { partsCost: input.partsCost } : {}),
        ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
      };
      if (input.scheduledAt !== undefined) {
        data.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
      }
      if (input.assigneeId !== undefined) {
        const assignee = input.assigneeId
          ? await this.assignee(tx, tenantId, input.assigneeId)
          : null;
        data.assigneeId = assignee?.id ?? null;
        data.assigneeName = assignee?.name ?? null;
      }
      const status = input.status ?? current.status;
      if (status === 'SCHEDULED' && !(data.scheduledAt ?? current.scheduledAt)) {
        throw new BadRequestException('Fixez la date de l’intervention pour la planifier.');
      }
      data.status = status;
      if (status === 'IN_PROGRESS' && !current.startedAt) data.startedAt = new Date();
      if (status === 'DONE') {
        const completedAt = input.completedAt ? new Date(input.completedAt) : new Date();
        data.completedAt = completedAt;
        data.startedAt = current.startedAt ?? completedAt;
        data.counter = await this.counterAt(tx, current.printerId, completedAt);
      }
      const updated = await tx.intervention.update({
        where: { id: interventionId },
        data,
        include: interventionInclude,
      });
      if (status === 'DONE' && updated.planId) {
        await this.evaluatePlan(tx, tenantId, updated.planId);
      }
      return { row: updated, previous: current };
    });
    await this.record(
      row.status !== previous.status
        ? `intervention.${row.status.toLowerCase()}`
        : 'intervention.updated',
      tenantId,
      row,
      actor,
      context,
      { number: row.number, from: previous.status, to: row.status },
    );
    return this.get(tenantId, interventionId);
  }

  // -- Plans de maintenance ------------------------------------------------------------------

  async plans(tenantId: string, printerId?: string): Promise<MaintenancePlan[]> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const rows = await tx.maintenancePlan.findMany({
        where: { tenantId, ...(printerId ? { printerId } : {}) },
        include: planInclude,
        orderBy: [{ printer: { name: 'asc' } }, { name: 'asc' }],
      });
      const plans: MaintenancePlan[] = [];
      for (const row of rows) plans.push(await this.describePlan(tx, row));
      const order = { OVERDUE: 0, DUE_SOON: 1, UNKNOWN: 2, OK: 3 };
      return plans.sort(
        (a, b) => Number(!a.active) - Number(!b.active) || order[a.state] - order[b.state],
      );
    });
  }

  async createPlan(
    tenantId: string,
    input: MaintenancePlanCreateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<MaintenancePlan> {
    const plan = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const printer = await tx.printer.findFirst({ where: { id: input.printerId, tenantId } });
      if (!printer) throw new BadRequestException('Machine introuvable dans cette entreprise.');
      const row = await tx.maintenancePlan.create({
        data: {
          tenantId,
          ...input,
          startCounter: await this.counterAt(tx, input.printerId, new Date()),
        },
        include: planInclude,
      });
      await this.evaluatePlan(tx, tenantId, row.id);
      return this.describePlan(tx, row);
    }).catch((error: unknown) => {
      throw isUniqueViolation(error)
        ? new ConflictException('Cette machine a déjà un plan de ce nom.')
        : error;
    });
    await this.audit.record({
      action: 'maintenance_plan.created',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'printer',
      targetId: plan.printer.id,
      metadata: {
        name: plan.name,
        intervalPages: plan.intervalPages,
        intervalDays: plan.intervalDays,
      },
      ...context,
    });
    return plan;
  }

  async updatePlan(
    tenantId: string,
    planId: string,
    input: MaintenancePlanUpdateInput,
    actor: Principal,
    context: RequestContext,
  ): Promise<MaintenancePlan> {
    const plan = await withTenant(this.appPrisma, tenantId, async (tx) => {
      const current = await tx.maintenancePlan.findFirst({ where: { id: planId, tenantId } });
      if (!current) throw new NotFoundException('Plan introuvable.');
      const intervalPages =
        input.intervalPages === undefined ? current.intervalPages : input.intervalPages;
      const intervalDays =
        input.intervalDays === undefined ? current.intervalDays : input.intervalDays;
      if (!intervalPages && !intervalDays) {
        throw new BadRequestException('Fixez un intervalle en pages, en jours, ou les deux.');
      }
      const row = await tx.maintenancePlan.update({
        where: { id: planId },
        data: input,
        include: planInclude,
      });
      await this.evaluatePlan(tx, tenantId, planId);
      return this.describePlan(tx, row);
    });
    await this.audit.record({
      action: 'maintenance_plan.updated',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'printer',
      targetId: plan.printer.id,
      metadata: { name: plan.name, ...input },
      ...context,
    });
    return plan;
  }

  /** Échéances de tous les plans d'une entreprise : alertes à prévoir ou dépassées. */
  async evaluatePlans(tenantId: string): Promise<void> {
    await withTenant(this.appPrisma, tenantId, async (tx) => {
      const plans = await tx.maintenancePlan.findMany({
        where: { tenantId },
        select: { id: true },
      });
      for (const plan of plans) await this.evaluatePlan(tx, tenantId, plan.id);
    });
  }

  private async evaluatePlan(tx: TransactionClient, tenantId: string, planId: string) {
    const row = await tx.maintenancePlan.findUniqueOrThrow({
      where: { id: planId },
      include: planInclude,
    });
    const plan = await this.describePlan(tx, row);
    const due = `maintenance-due:${planId}`;
    const overdue = `maintenance-overdue:${planId}`;
    const target = { printerId: row.printerId, planId };
    if (row.active && plan.state === 'OVERDUE') {
      await this.alerts.resolve(tx, tenantId, [due]);
      await this.alerts.raise(tx, tenantId, {
        type: 'MAINTENANCE_OVERDUE',
        severity: 'CRITICAL',
        dedupeKey: overdue,
        title: `Maintenance dépassée sur ${row.printer.name} : ${row.name}`,
        message: describeDue(plan),
        ...target,
      });
    } else if (row.active && plan.state === 'DUE_SOON') {
      await this.alerts.resolve(tx, tenantId, [overdue]);
      await this.alerts.raise(tx, tenantId, {
        type: 'MAINTENANCE_DUE',
        severity: 'WARNING',
        dedupeKey: due,
        title: `Maintenance à prévoir sur ${row.printer.name} : ${row.name}`,
        message: describeDue(plan),
        ...target,
      });
    } else {
      await this.alerts.resolve(tx, tenantId, [due, overdue]);
    }
  }

  private async describePlan(tx: TransactionClient, row: PlanRow): Promise<MaintenancePlan> {
    const done = await tx.intervention.findFirst({
      where: { planId: row.id, status: 'DONE' },
      orderBy: { completedAt: 'desc' },
      select: { id: true, completedAt: true, counter: true },
    });
    const open = await tx.intervention.findFirst({
      where: { planId: row.id, status: { in: ['OPEN', 'SCHEDULED', 'IN_PROGRESS'] } },
      orderBy: { reportedAt: 'desc' },
      select: { id: true, number: true, status: true },
    });
    const now = new Date();
    const lastDate = done?.completedAt ?? row.createdAt;
    const lastCounter = done ? done.counter : row.startCounter;
    const counter = await this.counterAt(tx, row.printerId, now);
    const status = planStatus({
      intervalPages: row.intervalPages,
      intervalDays: row.intervalDays,
      lastDate,
      lastCounter,
      counter,
      pagesPerDay: await this.pagesPerDay(tx, row.printerId),
      now,
    });
    return {
      id: row.id,
      printer: { id: row.printer.id, name: row.printer.name, siteName: row.printer.site.name },
      name: row.name,
      intervalPages: row.intervalPages,
      intervalDays: row.intervalDays,
      active: row.active,
      notes: row.notes,
      last: {
        date: lastDate.toISOString(),
        counter: lastCounter,
        interventionId: done?.id ?? null,
      },
      counter,
      pagesSince: status.pagesSince,
      daysSince: status.daysSince,
      progress: status.progress,
      state: row.active ? status.state : 'OK',
      dueAt: status.dueAt?.toISOString() ?? null,
      openIntervention: open,
    };
  }

  /** Compteur total de la machine au plus près d'une date (dernier relevé connu). */
  private async counterAt(
    tx: TransactionClient,
    printerId: string,
    at: Date,
  ): Promise<number | null> {
    const reading = await tx.meterReading.findFirst({
      where: { printerId, readAt: { lte: at } },
      orderBy: { readAt: 'desc' },
      select: { totalCount: true },
    });
    return reading?.totalCount ?? null;
  }

  /** Pages par jour sur les 90 derniers jours de relevés. */
  private async pagesPerDay(tx: TransactionClient, printerId: string): Promise<number | null> {
    const since = new Date(Date.now() - 90 * DAY_MS);
    // Requêtes successives : une transaction ne doit pas en exécuter deux à la fois.
    const first = await tx.meterReading.findFirst({
      where: { printerId, readAt: { gte: since } },
      orderBy: { readAt: 'asc' },
      select: { readAt: true, totalCount: true },
    });
    const last = await tx.meterReading.findFirst({
      where: { printerId, readAt: { gte: since } },
      orderBy: { readAt: 'desc' },
      select: { readAt: true, totalCount: true },
    });
    if (!first || !last) return null;
    const days = (last.readAt.getTime() - first.readAt.getTime()) / DAY_MS;
    const pages = last.totalCount - first.totalCount;
    return days >= 1 && pages > 0 ? pages / days : null;
  }

  private async assignee(tx: TransactionClient, tenantId: string, userId: string) {
    const user = await tx.user.findFirst({
      where: { id: userId, tenantId, status: 'ACTIVE', role: { in: ASSIGNABLE_ROLES } },
      select: { id: true, name: true },
    });
    if (!user) throw new BadRequestException('Personne introuvable ou sans droit d’intervenir.');
    return user;
  }

  private async currency(tx: TransactionClient, tenantId: string): Promise<string> {
    const { currency } = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { currency: true },
    });
    return currency;
  }

  private async record(
    action: string,
    tenantId: string,
    row: InterventionRow,
    actor: Principal,
    context: RequestContext,
    metadata: Record<string, unknown>,
  ) {
    await this.audit.record({
      action,
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      targetType: 'printer',
      targetId: row.printerId,
      metadata: { printer: row.printer.name, ...metadata },
      ...context,
    });
  }
}

function describeDue(plan: MaintenancePlan): string {
  const parts = [];
  if (plan.intervalPages && plan.pagesSince !== null) {
    parts.push(
      `${plan.pagesSince.toLocaleString('fr-FR')} pages sur ${plan.intervalPages.toLocaleString('fr-FR')}`,
    );
  }
  if (plan.intervalDays) parts.push(`${plan.daysSince} jours sur ${plan.intervalDays}`);
  return `Depuis la dernière maintenance : ${parts.join(', ')}.`;
}

function toIntervention(row: InterventionRow, currency: string): Intervention {
  const labor = row.laborCost === null ? null : Number(row.laborCost);
  const parts = row.partsCost === null ? null : Number(row.partsCost);
  return {
    id: row.id,
    number: row.number,
    printer: { id: row.printer.id, name: row.printer.name, siteName: row.printer.site.name },
    type: row.type,
    status: row.status,
    priority: row.priority,
    title: row.title,
    description: row.description,
    reportedAt: row.reportedAt.toISOString(),
    reportedByEmail: row.reportedByEmail,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    assignee: row.assigneeId ? { id: row.assigneeId, name: row.assigneeName ?? '' } : null,
    counter: row.counter,
    laborMinutes: row.laborMinutes,
    laborCost: labor,
    partsCost: parts,
    totalCost: labor === null && parts === null ? null : (labor ?? 0) + (parts ?? 0),
    resolution: row.resolution,
    plan: row.plan,
    currency,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
