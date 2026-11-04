import { describe, expect, it } from 'vitest';
import {
  alertListQuerySchema,
  stockCreateSchema,
  stockMovementCreateSchema,
  stockTransferSchema,
  tonerReplacementCreateSchema,
} from './stocks.js';

const SITE = '0195f5c4-1f2a-7c3e-9a51-0e3f4a5b6c7d';
const PRINTER = '0195f5c4-1f2a-7c3e-9a51-0e3f4a5b6c7e';

describe('stocks', () => {
  it('crée un article avec un seuil et un délai par défaut', () => {
    expect(stockCreateSchema.parse({ siteId: SITE, reference: ' TN-324K ' })).toEqual({
      siteId: SITE,
      reference: 'TN-324K',
      minQuantity: 0,
      leadTimeDays: 7,
    });
    expect(
      stockCreateSchema.safeParse({ siteId: SITE, reference: '', minQuantity: -1 }).success,
    ).toBe(false);
  });

  it('distingue réception, sortie et inventaire', () => {
    expect(
      stockMovementCreateSchema.parse({ type: 'RECEIPT', quantity: '6', unitCost: '45.5' }),
    ).toMatchObject({
      type: 'RECEIPT',
      quantity: 6,
      unitCost: 45.5,
    });
    // Un inventaire porte la quantité comptée, zéro compris.
    expect(
      stockMovementCreateSchema.parse({ type: 'ADJUSTMENT', countedQuantity: 0 }),
    ).toMatchObject({
      countedQuantity: 0,
    });
    expect(stockMovementCreateSchema.safeParse({ type: 'ISSUE', quantity: 0 }).success).toBe(false);
    expect(stockMovementCreateSchema.safeParse({ type: 'INSTALLATION', quantity: 1 }).success).toBe(
      false,
    );
    expect(
      stockMovementCreateSchema.safeParse({
        type: 'RECEIPT',
        quantity: 1,
        occurredAt: new Date(Date.now() + 86_400_000).toISOString(),
      }).success,
    ).toBe(false);
  });

  it('transfère une quantité positive', () => {
    expect(
      stockTransferSchema.safeParse({ fromStockId: SITE, toSiteId: SITE, quantity: -2 }).success,
    ).toBe(false);
  });
});

describe('remplacements et alertes', () => {
  it('accepte un remplacement pris ou non dans un stock', () => {
    const parsed = tonerReplacementCreateSchema.parse({
      printerId: PRINTER,
      channel: 'CYAN',
      replacedAt: '2026-11-01T10:00:00.000Z',
      stockId: '',
      previousLevelPercent: '',
    });
    expect(parsed).toMatchObject({ stockId: null, previousLevelPercent: null });
    expect(tonerReplacementCreateSchema.safeParse({ ...parsed, channel: 'ORANGE' }).success).toBe(
      false,
    );
  });

  it('filtre les alertes actives par défaut', () => {
    expect(alertListQuerySchema.parse({}).status).toBeUndefined();
    expect(alertListQuerySchema.parse({ status: 'ACTIVE', type: 'STOCK_OUT' })).toMatchObject({
      status: 'ACTIVE',
      type: 'STOCK_OUT',
    });
    expect(alertListQuerySchema.safeParse({ type: 'INCONNU' }).success).toBe(false);
  });
});
