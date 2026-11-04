import { describe, expect, it } from 'vitest';
import { detectJumps, levelTrend, stockForecast } from './forecast.js';

const DAY = 24 * 60 * 60 * 1000;
const start = new Date('2026-10-01T00:00:00Z');
const day = (n: number) => new Date(start.getTime() + n * DAY);

describe('stockForecast', () => {
  const base = {
    quantity: 6,
    minQuantity: 2,
    leadTimeDays: 10,
    engineRate: null,
    installations: 0,
    windowDays: 90,
    now: start,
  };

  it('suit le moteur CMJN quand il a estimé une consommation', () => {
    // 0,2 cartouche par jour : 6 cartouches tiennent 30 jours.
    const forecast = stockForecast({ ...base, engineRate: 0.2, installations: 45 });
    expect(forecast).toMatchObject({ method: 'engine', cartridgesPerDay: 0.2, daysOfCover: 30 });
    expect(forecast.stockoutAt).toBe(day(30).toISOString());
    // Couvrir 10 jours de délai et 30 jours : 8 cartouches, il en manque 2.
    expect(forecast.recommendedOrder).toBe(2);
  });

  it('se rabat sur l’historique des installations', () => {
    // 18 installations en 90 jours : 0,2 par jour.
    const forecast = stockForecast({ ...base, installations: 18 });
    expect(forecast).toMatchObject({ method: 'history', cartridgesPerDay: 0.2, daysOfCover: 30 });
  });

  it('ne prévoit rien sans consommation, mais remonte au seuil', () => {
    const forecast = stockForecast({ ...base, quantity: 1 });
    expect(forecast).toEqual({
      method: 'none',
      cartridgesPerDay: null,
      daysOfCover: null,
      stockoutAt: null,
      recommendedOrder: 2,
    });
    expect(stockForecast({ ...base, minQuantity: 0, quantity: 0 }).recommendedOrder).toBe(0);
  });
});

describe('niveaux SNMP', () => {
  const points = [
    { at: day(0), level: 60 },
    { at: day(10), level: 40 },
    { at: day(20), level: 12 },
    // Remplacement : de 12 à 100.
    { at: day(21), level: 100 },
    { at: day(26), level: 90 },
    { at: day(31), level: 80 },
  ];

  it('repère les remontées de niveau', () => {
    expect(detectJumps(points)).toEqual([{ at: day(21), before: 12, after: 100 }]);
    // Une petite remontée (recalibrage) n'en est pas une.
    expect(
      detectJumps([
        { at: day(0), level: 40 },
        { at: day(1), level: 55 },
      ]),
    ).toEqual([]);
  });

  it('prévoit l’épuisement depuis le dernier remplacement', () => {
    // Après le remplacement : -2 points par jour, 80 % restants le jour 31 : vide au jour 71.
    const trend = levelTrend(points, day(31));
    expect(trend.percentPerDay).toBe(2);
    expect(trend.emptyAt).toEqual(day(71));
  });

  it('ne conclut pas sur trop peu de mesures ou un niveau stable', () => {
    expect(levelTrend([{ at: day(0), level: 50 }], day(0)).emptyAt).toBeNull();
    expect(
      levelTrend(
        [
          { at: day(0), level: 50 },
          { at: day(0.5), level: 49 },
        ],
        day(1),
      ).emptyAt,
    ).toBeNull();
    expect(
      levelTrend(
        [
          { at: day(0), level: 50 },
          { at: day(5), level: 50 },
        ],
        day(5),
      ).emptyAt,
    ).toBeNull();
  });
});
