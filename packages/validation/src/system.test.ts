import { describe, expect, it } from 'vitest';
import { healthReportSchema, systemInfoSchema } from './system.js';

const up = { status: 'up', critical: true, latencyMs: 3 };

describe('healthReportSchema', () => {
  it('accepte un rapport complet', () => {
    const report = {
      status: 'ok',
      version: '0.1.0',
      checkedAt: new Date().toISOString(),
      dependencies: { database: up, redis: up, analytics: up, workers: up },
    };
    expect(healthReportSchema.parse(report)).toEqual(report);
  });

  it('refuse un rapport auquel il manque une dépendance', () => {
    const result = healthReportSchema.safeParse({
      status: 'ok',
      version: '0.1.0',
      checkedAt: new Date().toISOString(),
      dependencies: { database: up, redis: up, analytics: up },
    });
    expect(result.success).toBe(false);
  });
});

describe('systemInfoSchema', () => {
  it('refuse un mode de déploiement inconnu', () => {
    expect(
      systemInfoSchema.safeParse({ name: 'x', version: '1', deploymentMode: 'autre' }).success,
    ).toBe(false);
  });
});
