import { describe, expect, it } from 'vitest';
import {
  printJobEstimateQuerySchema,
  printJobUpdateSchema,
  printJobUploadSchema,
} from './print-jobs.js';

const PRINTER = '0196f1c2-7a5b-7c3d-8e9f-0a1b2c3d4e5f';

describe('travaux d’impression', () => {
  it('lit les champs texte d’un envoi de fichier', () => {
    expect(printJobUploadSchema.parse({ printerId: '', copies: '250' })).toEqual({
      printerId: undefined,
      copies: 250,
    });
    expect(printJobUploadSchema.parse({})).toEqual({ copies: 1 });
  });

  it('refuse zéro exemplaire ou une machine invalide', () => {
    expect(printJobUploadSchema.safeParse({ copies: '0' }).success).toBe(false);
    expect(printJobUploadSchema.safeParse({ printerId: 'presse' }).success).toBe(false);
  });

  it('permet de retirer la machine prévue', () => {
    expect(printJobUpdateSchema.parse({ printerId: null })).toEqual({ printerId: null });
    expect(printJobUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('applique la calibration sauf demande contraire', () => {
    expect(printJobEstimateQuerySchema.parse({ printerId: PRINTER })).toMatchObject({
      useCalibration: true,
    });
    expect(
      printJobEstimateQuerySchema.parse({
        printerId: PRINTER,
        useCalibration: 'false',
        copies: '3',
      }),
    ).toMatchObject({ useCalibration: false, copies: 3 });
  });
});
