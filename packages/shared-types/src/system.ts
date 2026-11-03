import type { DeploymentMode } from './domain.js';

export const DEPENDENCY_NAMES = ['database', 'redis', 'analytics', 'workers'] as const;
export type DependencyName = (typeof DEPENDENCY_NAMES)[number];

/** Une dépendance critique indisponible rend l'API non opérationnelle (HTTP 503). */
export const CRITICAL_DEPENDENCIES: readonly DependencyName[] = ['database', 'redis'];

export interface DependencyHealth {
  status: 'up' | 'down';
  critical: boolean;
  /** Durée de la vérification, ou `null` si elle n'a pas pu aboutir. */
  latencyMs: number | null;
  message?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  checkedAt: string;
  dependencies: Record<DependencyName, DependencyHealth>;
}

export interface SystemInfo {
  name: string;
  version: string;
  deploymentMode: DeploymentMode;
}

/** Contrat Redis et BullMQ entre l'API et les workers. */
export const SYSTEM_QUEUE = 'system';
export const WORKER_HEARTBEAT_JOB = 'worker-heartbeat';
export const WORKER_HEARTBEAT_KEY = 'arksen:workers:heartbeat';
export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000;
export const WORKER_HEARTBEAT_TTL_SECONDS = 90;
