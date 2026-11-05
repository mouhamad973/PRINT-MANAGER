import { describe, expect, it } from 'vitest';
import { planStatus } from './plan-status.js';

const DAY = 24 * 60 * 60 * 1000;
const last = new Date('2026-06-01T00:00:00Z');
const after = (days: number) => new Date(last.getTime() + days * DAY);

describe('planStatus', () => {
  const pages = {
    intervalPages: 100_000,
    intervalDays: null,
    lastDate: last,
    lastCounter: 500_000,
    pagesPerDay: 1000,
  };

  it('suit l’intervalle en pages et estime l’échéance au rythme actuel', () => {
    const status = planStatus({ ...pages, counter: 560_000, now: after(60) });
    // 60 000 pages sur 100 000 : 60 % ; 40 000 restantes à 1 000 par jour : 40 jours.
    expect(status).toMatchObject({ pagesSince: 60_000, progress: 0.6, state: 'OK' });
    expect(status.dueAt).toEqual(after(100));
  });

  it('passe à prévoir à 90 %, puis dépassée', () => {
    expect(planStatus({ ...pages, counter: 590_000, now: after(90) }).state).toBe('DUE_SOON');
    const overdue = planStatus({ ...pages, counter: 610_000, now: after(110) });
    expect(overdue).toMatchObject({ state: 'OVERDUE', progress: 1.1 });
    expect(overdue.dueAt).toEqual(after(110));
  });

  it('retient l’intervalle le plus avancé, en pages ou en jours', () => {
    const status = planStatus({
      ...pages,
      intervalDays: 180,
      counter: 520_000,
      now: after(170),
    });
    // 20 % des pages mais 94 % des jours : à prévoir, échéance au 180e jour.
    expect(status).toMatchObject({ state: 'DUE_SOON', daysSince: 170 });
    expect(status.dueAt).toEqual(after(180));
  });

  it('ne conclut pas sans compteur pour un intervalle en pages seulement', () => {
    expect(planStatus({ ...pages, counter: null, now: after(10) })).toMatchObject({
      state: 'UNKNOWN',
      progress: null,
      dueAt: null,
    });
  });
});
