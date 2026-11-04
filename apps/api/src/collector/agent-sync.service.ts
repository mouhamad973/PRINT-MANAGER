import { Prisma, withTenant, type PrismaClient, type TransactionClient } from '@arksen/database';
import {
  AGENT_SCHEMA_VERSION,
  type AgentAck,
  type AgentConfiguration,
  type AgentEnrollment,
  type AgentEventsResult,
  type AgentPrinterTarget,
  type CmykChannel,
} from '@arksen/shared-types';
import {
  agentEventSchema,
  type AgentEnrollInput,
  type AgentEventInput,
  type AgentEventsBatchInput,
} from '@arksen/validation';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AlertsService } from '../alerts/alerts.service.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../common/changes.js';
import { SECRET_BOX, SecretBox } from '../common/secret-box.js';
import { PRISMA_APP, PRISMA_SYSTEM } from '../database/database.module.js';
import { generateAgentToken, hashSecret } from './agent-credentials.js';
import type { AgentPrincipal } from './agent.guard.js';

/** Compteur total d'impressions de la Printer-MIB (RFC 3805) : prtMarkerLifeCount.1.1. */
export const PRINTER_MIB_TOTAL_OID = '1.3.6.1.2.1.43.10.2.1.4.1.1';

/** Un point d'historique de niveau inchangé n'est gardé que toutes les six heures. */
const LEVEL_KEEP_MS = 6 * 60 * 60 * 1000;

/** Un événement daté de plus de 5 minutes dans le futur trahit une horloge déréglée. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Tentatives d'enregistrement par adresse IP et par fenêtre : freine la recherche de codes. */
const ENROLL_LIMIT = 10;
const ENROLL_WINDOW_MS = 10 * 60 * 1000;

class Rejection extends Error {}

type Outcome = { status: 'accepted' } | { status: 'rejected'; error: string };

@Injectable()
export class AgentSyncService {
  private readonly logger = new Logger(AgentSyncService.name);
  private readonly enrollAttempts = new Map<string, number[]>();

  constructor(
    @Inject(PRISMA_APP) private readonly appPrisma: PrismaClient,
    @Inject(PRISMA_SYSTEM) private readonly systemPrisma: PrismaClient,
    @Inject(SECRET_BOX) private readonly secrets: SecretBox,
    private readonly audit: AuditService,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * Échange un code d'enregistrement contre un jeton. Le code est à usage unique et expire ;
   * le jeton n'est délivré qu'une fois et seule son empreinte est conservée.
   */
  async enroll(input: AgentEnrollInput, ipAddress: string | null): Promise<AgentEnrollment> {
    this.throttleEnrollment(ipAddress ?? 'inconnue');
    const now = new Date();
    const agent = await this.systemPrisma.collectorAgent.findUnique({
      where: { enrollmentCodeHash: hashSecret(input.code) },
      select: {
        id: true,
        tenantId: true,
        name: true,
        status: true,
        enrollmentExpiresAt: true,
        tenant: { select: { status: true } },
      },
    });
    if (
      !agent ||
      agent.status === 'REVOKED' ||
      !agent.enrollmentExpiresAt ||
      agent.enrollmentExpiresAt <= now
    ) {
      throw new HttpException(
        'Code d’enregistrement inconnu ou expiré : demandez-en un nouveau.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (agent.tenant.status !== 'ACTIVE') {
      throw new HttpException('L’entreprise de cet agent est suspendue.', HttpStatus.FORBIDDEN);
    }

    const token = generateAgentToken();
    // La condition sur l'empreinte du code rend l'échange atomique : un code ne sert qu'une fois.
    const { count } = await this.systemPrisma.collectorAgent.updateMany({
      where: { id: agent.id, enrollmentCodeHash: hashSecret(input.code) },
      data: {
        status: 'ACTIVE',
        tokenHash: hashSecret(token),
        enrollmentCodeHash: null,
        enrollmentExpiresAt: null,
        enrolledAt: now,
        lastSeenAt: now,
        lastIp: ipAddress,
        hostname: input.hostname,
        version: input.version,
        platform: input.platform ?? null,
      },
    });
    if (count !== 1) {
      throw new HttpException('Code d’enregistrement déjà utilisé.', HttpStatus.UNAUTHORIZED);
    }
    await this.audit.record({
      action: 'agent.enrolled',
      tenantId: agent.tenantId,
      targetType: 'agent',
      targetId: agent.id,
      metadata: { name: agent.name, hostname: input.hostname, version: input.version },
      ipAddress,
      userAgent: null,
    });
    return { agentId: agent.id, tenantId: agent.tenantId, name: agent.name, token };
  }

  /** Machines à interroger, avec leurs secrets SNMP déchiffrés : seul l'agent authentifié les reçoit. */
  async configuration(agent: AgentPrincipal): Promise<AgentConfiguration> {
    const printers = await withTenant(this.appPrisma, agent.tenantId, (tx) =>
      tx.printer.findMany({
        where: {
          tenantId: agent.tenantId,
          status: { not: 'RETIRED' },
          ...(agent.siteId ? { siteId: agent.siteId } : {}),
          connection: { OR: [{ ipAddress: { not: null } }, { hostname: { not: null } }] },
        },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          serialNumber: true,
          model: {
            select: { colorMode: true, snmpBlackCounterOid: true, snmpColorCounterOid: true },
          },
          connection: true,
        },
      }),
    );

    const targets: AgentPrinterTarget[] = [];
    for (const printer of printers) {
      const connection = printer.connection!;
      const open = (field: 'snmpCommunity' | 'snmpAuthPassword' | 'snmpPrivPassword') => {
        const sealed = connection[field];
        if (!sealed) return null;
        try {
          return this.secrets.decrypt(sealed, `printer:${printer.id}:${field}`);
        } catch {
          this.logger.error(`Secret SNMP illisible pour la machine ${printer.id} (${field})`);
          return null;
        }
      };
      targets.push({
        id: printer.id,
        name: printer.name,
        serialNumber: printer.serialNumber,
        colorMode: printer.model.colorMode,
        host: (connection.ipAddress ?? connection.hostname)!,
        snmp: {
          version: connection.snmpVersion,
          port: connection.snmpPort,
          community: open('snmpCommunity'),
          username: connection.snmpUsername,
          securityLevel: connection.snmpSecurityLevel,
          authProtocol: connection.snmpAuthProtocol,
          authPassword: open('snmpAuthPassword'),
          privProtocol: connection.snmpPrivProtocol,
          privPassword: open('snmpPrivPassword'),
        },
        counters: {
          totalOid: PRINTER_MIB_TOTAL_OID,
          blackOid: printer.model.snmpBlackCounterOid,
          colorOid: printer.model.colorMode === 'COLOR' ? printer.model.snmpColorCounterOid : null,
        },
      });
    }
    return {
      agent: { id: agent.id, name: agent.name, tenantId: agent.tenantId, siteId: agent.siteId },
      printers: targets,
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * Reçoit un lot de l'outbox d'un agent. Chaque événement est traité dans sa propre transaction
   * et acquitté : accepté, déjà reçu (doublon) ou rejeté avec sa raison. Un événement reçu deux
   * fois n'est traité qu'une fois.
   */
  async ingest(agent: AgentPrincipal, batch: AgentEventsBatchInput): Promise<AgentEventsResult> {
    const started = Date.now();
    const acks: AgentAck[] = [];
    const seen = new Set<string>();
    for (const raw of batch.events) {
      if (seen.has(raw.id)) {
        acks.push({ id: raw.id, status: 'duplicate' });
        continue;
      }
      seen.add(raw.id);
      acks.push(await this.ingestOne(agent, raw));
    }

    const tally = { accepted: 0, duplicate: 0, rejected: 0 };
    for (const ack of acks) tally[ack.status]++;
    await withTenant(this.appPrisma, agent.tenantId, async (tx) => {
      await tx.agentSyncLog.create({
        data: {
          tenantId: agent.tenantId,
          agentId: agent.id,
          received: acks.length,
          accepted: tally.accepted,
          duplicates: tally.duplicate,
          rejected: tally.rejected,
          durationMs: Date.now() - started,
        },
      });
      await tx.collectorAgent.update({
        where: { id: agent.id },
        data: { lastSyncAt: new Date(), lastSeenAt: new Date() },
      });
    });
    return { acks, serverTime: new Date().toISOString() };
  }

  private async ingestOne(
    agent: AgentPrincipal,
    raw: AgentEventsBatchInput['events'][number],
  ): Promise<AgentAck> {
    const previous = await withTenant(this.appPrisma, agent.tenantId, (tx) =>
      tx.agentEvent.findUnique({ where: { id: raw.id }, select: { status: true, error: true } }),
    );
    if (previous) {
      return previous.status === 'REJECTED'
        ? { id: raw.id, status: 'rejected', error: previous.error ?? 'Rejeté.' }
        : { id: raw.id, status: 'duplicate' };
    }

    const parsed = agentEventSchema.safeParse(raw);
    try {
      const outcome = await withTenant(this.appPrisma, agent.tenantId, async (tx) => {
        let result: Outcome = { status: 'accepted' };
        if (!parsed.success) {
          result = { status: 'rejected', error: describeIssue(parsed.error) };
        } else {
          try {
            await this.apply(tx, agent, parsed.data);
          } catch (error) {
            if (!(error instanceof Rejection)) throw error;
            result = { status: 'rejected', error: error.message };
          }
        }
        await tx.agentEvent.create({ data: eventRow(agent, raw, parsed.data, result) });
        return result;
      });
      return outcome.status === 'accepted'
        ? { id: raw.id, status: 'accepted' }
        : { id: raw.id, status: 'rejected', error: outcome.error };
    } catch (error) {
      // Même événement reçu en parallèle par une autre requête : il a déjà été traité.
      if (isUniqueViolation(error)) return { id: raw.id, status: 'duplicate' };
      throw error;
    }
  }

  /** Applique un événement valide. Une `Rejection` annule ses effets mais l'événement est journalisé. */
  private async apply(tx: TransactionClient, agent: AgentPrincipal, event: AgentEventInput) {
    if (event.agentId !== agent.id) {
      throw new Rejection('Événement émis par un autre agent.');
    }
    const occurredAt = new Date(event.occurredAt);
    if (occurredAt.getTime() > Date.now() + CLOCK_SKEW_MS) {
      throw new Rejection('Événement daté dans le futur : vérifiez l’horloge du poste de l’agent.');
    }

    switch (event.type) {
      case 'meter.reading': {
        const printer = await this.findPrinter(tx, agent, event.printerId);
        const { totalCount, blackCount, colorCount } = event.payload;
        let black: number;
        let color: number | null = null;
        if (printer.model.colorMode === 'MONOCHROME') {
          const value = blackCount ?? totalCount;
          if (value === null || value === undefined) {
            throw new Rejection('Relevé sans compteur.');
          }
          black = value;
        } else {
          if (
            blackCount === null ||
            blackCount === undefined ||
            colorCount === null ||
            colorCount === undefined
          ) {
            throw new Rejection(
              'Compteurs noir et couleur absents : renseignez leurs OID dans la fiche technique du modèle.',
            );
          }
          black = blackCount;
          color = colorCount;
        }
        // Un relevé existant au même instant (rejeu d'un import, par exemple) n'est pas dupliqué.
        await tx.meterReading.createMany({
          data: [
            {
              tenantId: agent.tenantId,
              printerId: printer.id,
              readAt: occurredAt,
              blackCount: black,
              colorCount: color,
              totalCount: black + (color ?? 0),
              source: 'AGENT',
              externalId: event.id,
              // Affiché « Agent · <nom de l'agent> » dans l'historique des relevés.
              createdByEmail: agent.name.slice(0, 255),
            },
          ],
          skipDuplicates: true,
        });
        return;
      }

      case 'printer.status': {
        const printer = await this.findPrinter(tx, agent, event.printerId);
        const payload = event.payload;
        // Niveaux des cartouches : historique, y compris pour un état reçu en retard.
        const levels = new Map<CmykChannel, number>();
        for (const supply of payload.supplies) {
          if (supply.channel && supply.levelPercent !== null && !levels.has(supply.channel)) {
            levels.set(supply.channel, supply.levelPercent);
          }
        }
        if (payload.reachable) {
          for (const [channel, level] of levels) {
            await this.recordLevel(tx, agent.tenantId, printer.id, channel, level, occurredAt);
          }
        }
        const current = await tx.printerState.findUnique({
          where: { printerId: printer.id },
          select: { observedAt: true },
        });
        // Un état reçu en retard (reprise après coupure) ne remplace pas un état plus récent.
        if (current && current.observedAt > occurredAt) return;
        const state = {
          agentId: agent.id,
          eventId: event.id,
          observedAt: occurredAt,
          reachable: payload.reachable,
          error: payload.error ?? null,
          deviceStatus: payload.deviceStatus ?? null,
          printerStatus: payload.printerStatus ?? null,
          alerts: payload.alerts,
          supplies: payload.supplies as Prisma.InputJsonValue,
          totalCount: payload.totalCount ?? null,
          serialNumber: payload.serialNumber ?? null,
          description: payload.description ?? null,
        };
        await tx.printerState.upsert({
          where: { printerId: printer.id },
          create: { printerId: printer.id, tenantId: agent.tenantId, ...state },
          update: state,
        });
        await tx.printer.update({
          where: { id: printer.id },
          data: {
            connectivity: payload.reachable ? 'ONLINE' : 'OFFLINE',
            ...(payload.reachable ? { lastSeenAt: occurredAt } : {}),
          },
        });
        if (payload.reachable) {
          for (const [channel, level] of levels) {
            await this.alerts.evaluateTonerLevel(tx, agent.tenantId, printer, channel, level);
          }
        }
        return;
      }

      case 'device.discovered': {
        const payload = event.payload;
        const serial = payload.serialNumber?.trim() || null;
        const match = serial
          ? await tx.printer.findFirst({
              where: {
                tenantId: agent.tenantId,
                serialNumber: { equals: serial, mode: 'insensitive' },
              },
              select: { id: true },
            })
          : null;
        const existing = await tx.discoveredDevice.findUnique({
          where: { tenantId_ipAddress: { tenantId: agent.tenantId, ipAddress: payload.ipAddress } },
          select: { id: true, lastSeenAt: true, printerId: true },
        });
        const details = {
          agentId: agent.id,
          serialNumber: serial,
          sysName: payload.sysName ?? null,
          description: payload.description ?? null,
          macAddress: payload.macAddress ?? null,
        };
        if (!existing) {
          await tx.discoveredDevice.create({
            data: {
              tenantId: agent.tenantId,
              ipAddress: payload.ipAddress,
              ...details,
              printerId: match?.id ?? null,
              firstSeenAt: occurredAt,
              lastSeenAt: occurredAt,
            },
          });
        } else if (existing.lastSeenAt <= occurredAt) {
          await tx.discoveredDevice.update({
            where: { id: existing.id },
            data: {
              ...details,
              lastSeenAt: occurredAt,
              ...(existing.printerId === null && match ? { printerId: match.id } : {}),
            },
          });
        }
        return;
      }
    }
  }

  /** Machine de l'entreprise de l'agent, dans son site s'il en a un. */
  private async findPrinter(
    tx: TransactionClient,
    agent: AgentPrincipal,
    printerId: string | null,
  ) {
    if (!printerId) {
      throw new Rejection('Événement sans machine.');
    }
    const printer = await tx.printer.findFirst({
      where: {
        id: printerId,
        tenantId: agent.tenantId,
        ...(agent.siteId ? { siteId: agent.siteId } : {}),
      },
      select: { id: true, name: true, model: { select: { colorMode: true } } },
    });
    if (!printer) {
      throw new Rejection('Machine inconnue pour cet agent.');
    }
    return printer;
  }

  /**
   * Point d'historique du niveau d'une cartouche, gardé seulement s'il change ou si le dernier
   * date de plus de six heures : la tendance reste lisible sans stocker chaque collecte.
   */
  private async recordLevel(
    tx: TransactionClient,
    tenantId: string,
    printerId: string,
    channel: CmykChannel,
    level: number,
    observedAt: Date,
  ) {
    const last = await tx.supplyLevelReading.findFirst({
      where: { printerId, channel, observedAt: { lte: observedAt } },
      orderBy: { observedAt: 'desc' },
      select: { observedAt: true, levelPercent: true },
    });
    if (
      last &&
      Number(last.levelPercent) === level &&
      observedAt.getTime() - last.observedAt.getTime() < LEVEL_KEEP_MS
    ) {
      return;
    }
    await tx.supplyLevelReading.createMany({
      data: [{ printerId, tenantId, channel, observedAt, levelPercent: level }],
      skipDuplicates: true,
    });
  }

  private throttleEnrollment(key: string) {
    const now = Date.now();
    const recent = (this.enrollAttempts.get(key) ?? []).filter(
      (time) => now - time < ENROLL_WINDOW_MS,
    );
    if (recent.length >= ENROLL_LIMIT) {
      throw new HttpException(
        'Trop de tentatives d’enregistrement : réessayez dans quelques minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.enrollAttempts.set(key, recent);
  }
}

function describeIssue(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  if (!issue) return 'Événement invalide.';
  const path = issue.path.map(String).join('.');
  return `Événement invalide${path ? ` (${path})` : ''} : ${issue.message}`.slice(0, 500);
}

/** Ligne du journal des événements, y compris pour un événement mal formé. */
function eventRow(
  agent: AgentPrincipal,
  raw: Record<string, unknown> & { id: string },
  event: AgentEventInput | undefined,
  outcome: Outcome,
): Prisma.AgentEventUncheckedCreateInput {
  const occurredAt = event ? new Date(event.occurredAt) : parseDate(raw.occurredAt);
  const type = event?.type ?? (typeof raw.type === 'string' ? raw.type : '');
  return {
    id: raw.id,
    tenantId: agent.tenantId,
    agentId: agent.id,
    type: (type || 'inconnu').slice(0, 60),
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : AGENT_SCHEMA_VERSION,
    printerId: event?.printerId ?? (isUuid(raw.printerId) ? raw.printerId : null),
    occurredAt,
    status: outcome.status === 'accepted' ? 'ACCEPTED' : 'REJECTED',
    error: outcome.status === 'rejected' ? outcome.error : null,
    payload: (event?.payload ?? raw.payload ?? {}) as Prisma.InputJsonValue,
  };
}

function parseDate(value: unknown): Date {
  const date = typeof value === 'string' ? new Date(value) : new Date(Number.NaN);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
