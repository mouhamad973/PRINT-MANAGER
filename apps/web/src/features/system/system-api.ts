import type { HealthReport, SystemInfo } from '@arksen/shared-types';
import { healthReportSchema, systemInfoSchema } from '@arksen/validation';

/** Un 503 de /health porte un rapport valide : seul un corps invalide est une panne de l'API. */
export async function fetchHealth(): Promise<HealthReport> {
  const response = await fetch('/backend/health', { cache: 'no-store' });
  const body: unknown = await response.json().catch(() => null);
  return healthReportSchema.parse(body);
}

export async function fetchSystemInfo(): Promise<SystemInfo> {
  const response = await fetch('/backend/api/v1/system/info', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Réponse HTTP ${response.status}`);
  }
  return systemInfoSchema.parse(await response.json());
}
