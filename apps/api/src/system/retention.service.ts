import type { PrismaClient } from '@arksen/database';
import {
  RETENTION_TARGETS,
  type RetentionRun,
  type RetentionStatus,
  type RetentionTarget,
} from '@arksen/shared-types';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AuditService } from '../audit/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PRISMA_SYSTEM } from '../database/database.module.js';
import { REDIS } from '../redis/redis.module.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_RUN_KEY = 'arksen:retention:last-run';
/** Les grosses tables sont purgées par lots, pour ne jamais bloquer longtemps les écritures. */
const BATCH_SIZE = 5000;

/** Date limite : les données antérieures sont purgées. */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/**
 * Politique de conservation des données (spécification §16). Les registres comptables et de
 * stock, les relevés émis et les compteurs ne sont jamais purgés : seules les traces techniques
 * le sont, et le journal d'audit après un an au moins (plancher imposé aussi par PostgreSQL).
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  policy(): Record<RetentionTarget, number> {
    return {
      auditLogs: this.config.RETENTION_AUDIT_DAYS,
      agentEvents: this.config.RETENTION_AGENT_EVENTS_DAYS,
      agentSyncLogs: this.config.RETENTION_SYNC_LOGS_DAYS,
      supplyLevels: this.config.RETENTION_SUPPLY_LEVELS_DAYS,
      resolvedAlerts: this.config.RETENTION_ALERTS_DAYS,
    };
  }

  async status(): Promise<RetentionStatus> {
    let lastRun: RetentionRun | null = null;
    try {
      const raw = await this.redis.get(LAST_RUN_KEY);
      lastRun = raw ? (JSON.parse(raw) as RetentionRun) : null;
    } catch (error) {
      this.logger.warn(`Dernière purge illisible : ${(error as Error).message}`);
    }
    return { policy: this.policy(), lastRun };
  }

  async run(
    trigger: RetentionRun['trigger'],
    actor?: { userId: string; email: string },
  ): Promise<RetentionRun> {
    const startedAt = new Date();
    const policy = this.policy();
    const purged = Object.fromEntries(RETENTION_TARGETS.map((target) => [target, 0])) as Record<
      RetentionTarget,
      number
    >;
    const cutoff = (target: RetentionTarget) => retentionCutoff(startedAt, policy[target]);

    purged.agentEvents = await this.inBatches(
      (limit) => this.prisma.$executeRaw`
        DELETE FROM "agent_events" WHERE ctid IN (
          SELECT ctid FROM "agent_events" WHERE "received_at" < ${cutoff('agentEvents')} LIMIT ${limit}
        )`,
    );
    purged.agentSyncLogs = await this.inBatches(
      (limit) => this.prisma.$executeRaw`
        DELETE FROM "agent_sync_logs" WHERE ctid IN (
          SELECT ctid FROM "agent_sync_logs" WHERE "received_at" < ${cutoff('agentSyncLogs')} LIMIT ${limit}
        )`,
    );
    // Le dernier niveau connu de chaque toner est gardé, quelle que soit sa date.
    purged.supplyLevels = await this.inBatches(
      (limit) => this.prisma.$executeRaw`
        DELETE FROM "supply_level_readings" WHERE ctid IN (
          SELECT r.ctid FROM "supply_level_readings" r
          WHERE r."observed_at" < ${cutoff('supplyLevels')}
            AND r."observed_at" < (
              SELECT max(l."observed_at") FROM "supply_level_readings" l
              WHERE l."printer_id" = r."printer_id" AND l."channel" = r."channel"
            )
          LIMIT ${limit}
        )`,
    );
    const alerts = await this.prisma.alert.deleteMany({
      where: { status: 'RESOLVED', resolvedAt: { lt: cutoff('resolvedAlerts') } },
    });
    purged.resolvedAlerts = alerts.count;
    const [audit] = await this.prisma.$queryRaw<{ purged: number }[]>`
      SELECT "purge_audit_logs"(${cutoff('auditLogs')}::timestamptz) AS purged`;
    purged.auditLogs = Number(audit?.purged ?? 0);

    const result: RetentionRun = {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      purged,
      trigger,
    };
    try {
      await this.redis.set(LAST_RUN_KEY, JSON.stringify(result));
    } catch (error) {
      this.logger.warn(`Dernière purge non mémorisée : ${(error as Error).message}`);
    }
    await this.audit.record({
      action: 'system.retention_applied',
      actorUserId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
      metadata: { trigger, policy, purged },
    });
    return result;
  }

  private async inBatches(deleteBatch: (limit: number) => Promise<number>): Promise<number> {
    let total = 0;
    for (;;) {
      const count = await deleteBatch(BATCH_SIZE);
      total += count;
      if (count < BATCH_SIZE) return total;
    }
  }
}
