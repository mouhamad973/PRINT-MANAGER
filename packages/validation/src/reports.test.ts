import { describe, expect, it } from 'vitest';
import { auditExportQuerySchema, reportQuerySchema, statisticsQuerySchema } from './reports.js';

describe('rapports', () => {
  it('exporte en PDF par défaut', () => {
    expect(reportQuerySchema.parse({}).format).toBe('pdf');
    expect(reportQuerySchema.parse({ format: 'csv' }).format).toBe('csv');
  });

  it('refuse un format inconnu et une période inversée', () => {
    expect(reportQuerySchema.safeParse({ format: 'docx' }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ from: '2026-06-01', to: '2026-05-01' }).success).toBe(
      false,
    );
  });

  it('limite une période de rapport à deux ans', () => {
    expect(reportQuerySchema.safeParse({ from: '2023-01-01', to: '2026-01-01' }).success).toBe(
      false,
    );
    expect(reportQuerySchema.safeParse({ from: '2025-01-01', to: '2026-01-01' }).success).toBe(
      true,
    );
  });

  it('borne les statistiques entre 3 et 12 mois', () => {
    expect(statisticsQuerySchema.parse({}).months).toBe(6);
    expect(statisticsQuerySchema.safeParse({ months: '2' }).success).toBe(false);
    expect(statisticsQuerySchema.safeParse({ months: '13' }).success).toBe(false);
  });

  it('exige les deux bornes d’un export du journal d’audit', () => {
    expect(auditExportQuerySchema.safeParse({ from: '2026-01-01' }).success).toBe(false);
    expect(auditExportQuerySchema.safeParse({ from: '2026-01-01', to: '2026-02-01' }).success).toBe(
      true,
    );
  });
});
