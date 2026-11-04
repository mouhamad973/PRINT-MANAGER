import { describe, expect, it } from 'vitest';
import {
  calibrationProfileSchema,
  measurementCreateSchema,
  simulationSchema,
  tonerPriceSchema,
  tonerSpecSchema,
} from './consumption.js';

const coverage = { CYAN: 5, MAGENTA: 5, YELLOW: 5, BLACK: 5 };

describe('toners', () => {
  it('applique la couverture de référence ISO par défaut', () => {
    expect(
      tonerSpecSchema.parse({
        reference: 'TN-1',
        capacityGrams: '310,5'.replace(',', '.'),
        yieldPages: '15000',
      }),
    ).toEqual({
      reference: 'TN-1',
      capacityGrams: 310.5,
      yieldPages: 15000,
      referenceCoverage: 5,
    });
  });

  it('refuse une capacité nulle ou un rendement décimal', () => {
    expect(
      tonerSpecSchema.safeParse({ reference: 'TN', capacityGrams: 0, yieldPages: 10 }).success,
    ).toBe(false);
    expect(
      tonerSpecSchema.safeParse({ reference: 'TN', capacityGrams: 1, yieldPages: 10.5 }).success,
    ).toBe(false);
  });

  it('accepte un prix vide pour le retirer', () => {
    expect(tonerPriceSchema.parse({ unitPrice: '' })).toEqual({ unitPrice: null });
  });
});

describe('calibration', () => {
  it('borne les couvertures et les coefficients', () => {
    const valid = {
      coverage,
      paperFormat: 'A4',
      mediaFactor: 1,
      manualCoefficients: { CYAN: '', MAGENTA: null, YELLOW: 1.2, BLACK: undefined },
    };
    expect(calibrationProfileSchema.parse(valid).manualCoefficients).toEqual({
      CYAN: null,
      MAGENTA: null,
      YELLOW: 1.2,
      BLACK: null,
    });
    expect(
      calibrationProfileSchema.safeParse({ ...valid, coverage: { ...coverage, CYAN: 120 } })
        .success,
    ).toBe(false);
    expect(
      calibrationProfileSchema.safeParse({
        ...valid,
        manualCoefficients: { ...valid.manualCoefficients, BLACK: 0 },
      }).success,
    ).toBe(false);
  });
});

describe('mesures', () => {
  const base = { channel: 'BLACK', from: '2026-10-01', to: '2026-10-31', notes: '' };

  it('exige la masse d’une pesée et le nombre de cartouches d’une estimation', () => {
    expect(measurementCreateSchema.safeParse({ ...base, method: 'WEIGHING' }).success).toBe(false);
    expect(
      measurementCreateSchema.safeParse({ ...base, method: 'CARTRIDGES', grams: 10 }).success,
    ).toBe(false);
    expect(
      measurementCreateSchema.parse({ ...base, method: 'CARTRIDGES', cartridges: '1.5' }),
    ).toMatchObject({
      cartridges: 1.5,
      grams: null,
    });
  });

  it('refuse une période inversée', () => {
    expect(
      measurementCreateSchema.safeParse({
        ...base,
        from: '2026-11-01',
        method: 'WEIGHING',
        grams: 5,
      }).success,
    ).toBe(false);
  });
});

describe('simulation', () => {
  it('exige une machine ou un modèle, pas les deux', () => {
    const job = { pages: 100, colorPages: 40, coverage };
    expect(simulationSchema.safeParse(job).success).toBe(false);
    expect(
      simulationSchema.parse({ ...job, modelId: '0196f1c2-7a5b-7c3d-8e9f-0a1b2c3d4e5f' }),
    ).toMatchObject({ paperFormat: 'A4', mediaFactor: 1, useCalibration: true });
  });

  it('refuse plus de pages couleur que de pages', () => {
    const result = simulationSchema.safeParse({
      modelId: '0196f1c2-7a5b-7c3d-8e9f-0a1b2c3d4e5f',
      pages: 10,
      colorPages: 11,
      coverage,
    });
    expect(result.error?.issues[0]?.message).toBe('Les pages couleur ne dépassent pas le total.');
  });
});
