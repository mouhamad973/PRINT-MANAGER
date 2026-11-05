import { describe, expect, it } from 'vitest';
import {
  contractCreateSchema,
  interventionUpdateSchema,
  invoiceCreateSchema,
  maintenancePlanCreateSchema,
  paperTypeCreateSchema,
  periodQuerySchema,
  printerCostSettingsSchema,
} from './operations.js';

const PRINTER = '0195f5c4-1f2a-7c3e-9a51-0e3f4a5b6c7e';

describe('papier et coûts', () => {
  it('crée un papier avec une rame de 500 feuilles par défaut', () => {
    expect(
      paperTypeCreateSchema.parse({ name: 'A4 80 g', format: 'A4', reamPrice: '3500' }),
    ).toMatchObject({
      sheetsPerReam: 500,
      reamPrice: 3500,
      grammage: null,
    });
    expect(paperTypeCreateSchema.safeParse({ name: 'X', format: 'A5' }).success).toBe(false);
  });

  it('borne le recto verso et accepte un coût fixe vide', () => {
    expect(
      printerCostSettingsSchema.parse({
        paperTypeId: '',
        duplexPercent: '40',
        monthlyFixedCost: '',
      }),
    ).toEqual({
      paperTypeId: null,
      duplexPercent: 40,
      monthlyFixedCost: null,
    });
    expect(printerCostSettingsSchema.safeParse({ duplexPercent: 120 }).success).toBe(false);
  });

  it('limite une période à deux ans, dans l’ordre', () => {
    expect(periodQuerySchema.safeParse({ from: '2026-01-01', to: '2026-01-31' }).success).toBe(
      true,
    );
    expect(periodQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-31' }).success).toBe(
      false,
    );
    expect(periodQuerySchema.safeParse({ from: '2023-01-01', to: '2026-01-31' }).success).toBe(
      false,
    );
  });
});

describe('contrats', () => {
  it('crée un contrat mensuel en cours par défaut', () => {
    const contract = contractCreateSchema.parse({
      reference: 'CTR-01',
      customerName: 'Client',
      startDate: '2026-01-01',
      blackPagePrice: '6',
      colorPagePrice: '45',
    });
    expect(contract).toMatchObject({
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      fixedFee: 0,
      endDate: null,
    });
  });

  it('refuse une fin avant le début et un relevé à l’envers', () => {
    expect(
      contractCreateSchema.safeParse({
        reference: 'CTR-01',
        customerName: 'Client',
        startDate: '2026-02-01',
        endDate: '2026-01-01',
        blackPagePrice: 6,
        colorPagePrice: 45,
      }).success,
    ).toBe(false);
    expect(
      invoiceCreateSchema.safeParse({ periodStart: '2026-02-01', periodEnd: '2026-01-31' }).success,
    ).toBe(false);
  });
});

describe('interventions et maintenance', () => {
  it('exige le compte rendu pour clore une intervention', () => {
    expect(interventionUpdateSchema.safeParse({ status: 'DONE' }).success).toBe(false);
    expect(
      interventionUpdateSchema.safeParse({ status: 'DONE', resolution: 'Rouleaux remplacés' })
        .success,
    ).toBe(true);
  });

  it('exige un intervalle en pages ou en jours', () => {
    expect(
      maintenancePlanCreateSchema.safeParse({ printerId: PRINTER, name: 'Révision' }).success,
    ).toBe(false);
    expect(
      maintenancePlanCreateSchema.parse({
        printerId: PRINTER,
        name: 'Révision',
        intervalDays: '180',
        intervalPages: '',
      }),
    ).toMatchObject({ intervalDays: 180, intervalPages: null, active: true });
  });
});
