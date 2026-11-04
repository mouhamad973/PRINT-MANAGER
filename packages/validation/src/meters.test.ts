import { describe, expect, it } from 'vitest';
import { meterImportSchema, meterReadingCreateSchema, volumeQuerySchema } from './meters.js';

describe('relevés', () => {
  it('convertit les compteurs saisis et accepte un relevé noir et blanc', () => {
    expect(
      meterReadingCreateSchema.parse({
        readAt: '2026-11-04T09:30:00+00:00',
        blackCount: '12500',
        colorCount: '',
      }),
    ).toMatchObject({ blackCount: 12500, colorCount: null, isReset: false, notes: null });
  });

  it('refuse un compteur négatif, décimal ou une date sans fuseau', () => {
    const result = meterReadingCreateSchema.safeParse({
      readAt: '2026-11-04T09:30',
      blackCount: -1,
      colorCount: 2.5,
    });
    const messages = result.error?.issues.map((issue) => issue.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'Saisissez la date et l’heure du relevé.',
        'Le compteur noir et blanc ne peut pas être négatif.',
        'Le compteur couleur est un nombre entier.',
      ]),
    );
  });

  it('limite la taille d’un import', () => {
    expect(meterImportSchema.safeParse({ rows: [] }).success).toBe(false);
  });
});

describe('périodes de volumes', () => {
  it('choisit le jour pour une période courte et le mois au-delà de trois mois', () => {
    expect(volumeQuerySchema.parse({ from: '2026-10-01', to: '2026-10-31' })).toMatchObject({
      granularity: 'day',
      compare: 'previous',
    });
    expect(volumeQuerySchema.parse({ from: '2026-01-01', to: '2026-10-31' }).granularity).toBe(
      'month',
    );
  });

  it('refuse une période inversée ou trop longue', () => {
    expect(volumeQuerySchema.safeParse({ from: '2026-10-31', to: '2026-10-01' }).success).toBe(
      false,
    );
    expect(volumeQuerySchema.safeParse({ from: '2020-01-01', to: '2026-10-01' }).success).toBe(
      false,
    );
  });
});
