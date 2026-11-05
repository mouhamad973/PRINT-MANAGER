import { describe, expect, it } from 'vitest';
import { computeCosts, DAYS_PER_MONTH, sumCosts } from './cost-model.js';

describe('computeCosts', () => {
  // 1 000 pages dont 200 couleur ; toner noir 20, couleur 30 ; papier à 0,01 la feuille.
  const base = {
    pages: 1000,
    colorPages: 200,
    blackToner: 20,
    colorToner: 30,
    sheetPrice: 0.01,
    duplexPercent: 0,
    maintenance: 15,
    monthlyFixed: null,
    days: 30,
  };

  it('additionne toner, papier, maintenance et coûts fixes', () => {
    const costs = computeCosts(base);
    // Papier : 1 000 feuilles × 0,01 = 10. Total : 50 + 10 + 15 = 75.
    expect(costs).toMatchObject({ toner: 50, paper: 10, maintenance: 15, fixed: 0, total: 75 });
    expect(costs.costPerPage).toBe(0.075);
    // Page noire : (20 + 10 + 15) / 1 000 = 0,045. Page couleur : 0,045 + 30 / 200 = 0,195.
    expect(costs.costPerBlackPage).toBe(0.045);
    expect(costs.costPerColorPage).toBe(0.195);
  });

  it('compte deux pages par feuille en recto verso', () => {
    // 50 % de recto verso : 750 feuilles.
    expect(computeCosts({ ...base, duplexPercent: 50 }).paper).toBe(7.5);
    expect(computeCosts({ ...base, duplexPercent: 100 }).paper).toBe(5);
  });

  it('proratise les coûts fixes mensuels', () => {
    expect(computeCosts({ ...base, monthlyFixed: 100, days: DAYS_PER_MONTH }).fixed).toBe(100);
    expect(computeCosts({ ...base, monthlyFixed: 100, days: DAYS_PER_MONTH / 2 }).fixed).toBe(50);
  });

  it('laisse inconnu ce qui l’est, sans l’inventer', () => {
    const costs = computeCosts({ ...base, colorToner: null, sheetPrice: null });
    expect(costs).toMatchObject({ toner: null, paper: null, total: 15 });
    expect(computeCosts({ ...base, pages: 0, colorPages: 0 }).costPerPage).toBeNull();
    // Machine noir et blanc : pas de coût de page couleur.
    expect(computeCosts({ ...base, colorPages: 0, colorToner: 0 }).costPerColorPage).toBeNull();
  });

  it('additionne plusieurs machines', () => {
    const one = { ...computeCosts(base), blackToner: 20, colorToner: 30 };
    const total = sumCosts([one, one]);
    expect(total).toMatchObject({
      pages: 2000,
      total: 150,
      costPerBlackPage: 0.045,
      costPerColorPage: 0.195,
    });
  });
});
