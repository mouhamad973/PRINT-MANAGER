import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { comparisonPeriod } from './meters.service.js';

describe('comparisonPeriod', () => {
  it('prend la période précédente de même durée, sans chevauchement', () => {
    expect(comparisonPeriod('2026-10-01', '2026-10-31', 'previous')).toEqual({
      from: '2026-08-31',
      to: '2026-09-30',
    });
    expect(comparisonPeriod('2026-11-04', '2026-11-04', 'previous')).toEqual({
      from: '2026-11-03',
      to: '2026-11-03',
    });
  });

  it('prend la même période un an plus tôt', () => {
    expect(comparisonPeriod('2026-01-01', '2026-03-31', 'year')).toEqual({
      from: '2025-01-01',
      to: '2025-03-31',
    });
  });

  it('ramène le 29 février au 1er mars d’une année non bissextile', () => {
    expect(comparisonPeriod('2028-02-29', '2028-02-29', 'year')).toEqual({
      from: '2027-03-01',
      to: '2027-03-01',
    });
  });
});
