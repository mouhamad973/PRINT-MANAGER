import { describe, expect, it } from 'vitest';
import { bill, invoiceNumber } from './billing.js';

const terms = {
  fixedFee: 50000,
  includedBlackPages: 5000,
  includedColorPages: 1000,
  blackPagePrice: 6,
  colorPagePrice: 45,
};

describe('bill', () => {
  it('facture le forfait et les pages au-delà des pages incluses', () => {
    // 7 500 pages noires : 2 500 en plus, à 6. 1 200 couleur : 200 en plus, à 45.
    expect(bill(terms, 7500, 1200)).toEqual({
      blackPages: 7500,
      colorPages: 1200,
      extraBlackPages: 2500,
      extraColorPages: 200,
      extraBlackAmount: 15000,
      extraColorAmount: 9000,
      totalAmount: 74000,
    });
  });

  it('ne facture que le forfait sous les pages incluses', () => {
    expect(bill(terms, 3000, 0)).toMatchObject({ extraBlackPages: 0, totalAmount: 50000 });
  });

  it('arrondit les pages à l’unité et les montants au centime', () => {
    const result = bill(
      { ...terms, fixedFee: 0, includedBlackPages: 0, blackPagePrice: 0.0123 },
      1000.4,
      0,
    );
    expect(result).toMatchObject({ blackPages: 1000, extraBlackAmount: 12.3, totalAmount: 12.3 });
  });
});

describe('invoiceNumber', () => {
  it('numérote par année sur quatre chiffres', () => {
    expect(invoiceNumber(2026, 1)).toBe('REL-2026-0001');
    expect(invoiceNumber(2026, 12345)).toBe('REL-2026-12345');
  });
});
