import { describe, expect, it } from 'vitest';
import {
  currentAnomalies,
  dailyVolumes,
  mergeDays,
  periodTotals,
  readingAnomalies,
  toIntervals,
  volumeSeries,
  type Reading,
} from './meter-analysis.js';

let sequence = 0;
function reading(
  iso: string,
  black: number,
  color: number | null = null,
  isReset = false,
): Reading {
  return {
    id: `r${++sequence}`,
    readAt: new Date(iso),
    blackCount: black,
    colorCount: color,
    isReset,
  };
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('toIntervals', () => {
  it('calcule les pages entre deux relevés, canal par canal', () => {
    const [interval] = toIntervals([
      reading('2026-10-01T00:00:00Z', 1000, 500),
      reading('2026-10-11T00:00:00Z', 1300, 700),
    ]);
    expect(interval).toMatchObject({ reason: 'ok', pages: { black: 300, color: 200, total: 500 } });
  });

  it('ne calcule rien quand le compteur baisse ou a été remis à zéro', () => {
    const intervals = toIntervals([
      reading('2026-10-01T00:00:00Z', 1000),
      reading('2026-10-02T00:00:00Z', 900),
      reading('2026-10-03T00:00:00Z', 50, null, true),
      reading('2026-10-04T00:00:00Z', 80),
    ]);
    expect(intervals.map((interval) => interval.reason)).toEqual(['decrease', 'reset', 'ok']);
    expect(intervals[2]!.pages).toEqual({ black: 30, color: 0, total: 30 });
  });
});

describe('dailyVolumes', () => {
  it('répartit un intervalle à parts égales sur les jours qu’il couvre', () => {
    const intervals = toIntervals([
      reading('2026-10-01T00:00:00Z', 0, 0),
      reading('2026-10-11T00:00:00Z', 1000, 100),
    ]);
    const days = dailyVolumes(intervals, day('2026-10-01'), day('2026-10-10'));
    const { series, totals } = volumeSeries(days, 'day');

    expect(series).toHaveLength(10);
    expect(series[0]).toEqual({
      period: '2026-10-01',
      black: 100,
      color: 10,
      total: 110,
      coverage: 1,
    });
    expect(totals).toEqual({ black: 1000, color: 100, total: 1100, coverage: 1 });
  });

  it('coupe un intervalle qui déborde de la période, au prorata du temps', () => {
    const intervals = toIntervals([
      reading('2026-09-26T00:00:00Z', 0),
      reading('2026-10-06T00:00:00Z', 1000),
    ]);
    // Du 1er au 5 octobre : 5 jours sur 10.
    const totals = periodTotals(dailyVolumes(intervals, day('2026-10-01'), day('2026-10-05')));
    expect(totals).toMatchObject({ black: 500, total: 500, coverage: 1 });
  });

  it('laisse inconnus les jours sans relevé, au lieu de les compter à zéro', () => {
    const intervals = toIntervals([
      reading('2026-10-01T00:00:00Z', 0),
      reading('2026-10-03T00:00:00Z', 200),
    ]);
    const { series, totals } = volumeSeries(
      dailyVolumes(intervals, day('2026-10-01'), day('2026-10-04')),
      'day',
    );
    expect(series.map((point) => point.coverage)).toEqual([1, 1, 0, 0]);
    expect(totals).toMatchObject({ total: 200, coverage: 0.5 });
  });

  it('ignore les intervalles non calculables', () => {
    const intervals = toIntervals([
      reading('2026-10-01T00:00:00Z', 1000),
      reading('2026-10-03T00:00:00Z', 10, null, true),
    ]);
    expect(
      periodTotals(dailyVolumes(intervals, day('2026-10-01'), day('2026-10-02'))),
    ).toMatchObject({
      total: 0,
      coverage: 0,
    });
  });

  it('regroupe par mois', () => {
    const intervals = toIntervals([
      reading('2026-09-01T00:00:00Z', 0),
      reading('2026-11-01T00:00:00Z', 6100),
    ]);
    const { series } = volumeSeries(
      dailyVolumes(intervals, day('2026-09-01'), day('2026-10-31')),
      'month',
    );
    // 30 jours en septembre, 31 en octobre, sur 61 : 100 pages par jour.
    expect(series).toEqual([
      { period: '2026-09', black: 3000, color: 0, total: 3000, coverage: 1 },
      { period: '2026-10', black: 3100, color: 0, total: 3100, coverage: 1 },
    ]);
  });

  it('additionne les machines du parc et moyenne leur couverture', () => {
    const a = dailyVolumes(
      toIntervals([reading('2026-10-01T00:00:00Z', 0), reading('2026-10-02T00:00:00Z', 100)]),
      day('2026-10-01'),
      day('2026-10-01'),
    );
    const b = dailyVolumes([], day('2026-10-01'), day('2026-10-01'));
    const fleet = new Map();
    mergeDays(fleet, a);
    mergeDays(fleet, b);
    expect(periodTotals(fleet)).toEqual({ black: 100, color: 0, total: 100, coverage: 0.5 });
  });
});

describe('readingAnomalies', () => {
  it('signale une baisse de compteur sur le relevé en cause', () => {
    const readings = [reading('2026-10-01T00:00:00Z', 1000), reading('2026-10-02T00:00:00Z', 900)];
    const anomalies = readingAnomalies(toIntervals(readings), { monthlyDutyCycle: null });
    expect(anomalies.get(readings[1]!.id)?.map((item) => item.code)).toEqual(['COUNTER_DECREASE']);
  });

  it('ne signale pas une remise à zéro déclarée', () => {
    const readings = [
      reading('2026-10-01T00:00:00Z', 1000),
      reading('2026-10-02T00:00:00Z', 10, null, true),
    ];
    expect(readingAnomalies(toIntervals(readings), { monthlyDutyCycle: null }).size).toBe(0);
  });

  it('signale un pic par rapport au débit habituel de la machine', () => {
    const readings = [
      reading('2026-10-01T00:00:00Z', 0),
      reading('2026-10-02T00:00:00Z', 100),
      reading('2026-10-03T00:00:00Z', 200),
      reading('2026-10-04T00:00:00Z', 300),
      reading('2026-10-05T00:00:00Z', 1300),
    ];
    const anomalies = readingAnomalies(toIntervals(readings), { monthlyDutyCycle: null });
    expect([...anomalies.keys()]).toEqual([readings[4]!.id]);
    expect(anomalies.get(readings[4]!.id)![0]!.code).toBe('VOLUME_SPIKE');
  });

  it('ne crie pas au pic sans historique suffisant ou sur quelques pages', () => {
    const short = [reading('2026-10-01T00:00:00Z', 0), reading('2026-10-02T00:00:00Z', 5000)];
    expect(readingAnomalies(toIntervals(short), { monthlyDutyCycle: null }).size).toBe(0);

    const small = [0, 10, 20, 30, 200].map((count, index) =>
      reading(`2026-10-0${index + 1}T00:00:00Z`, count),
    );
    expect(readingAnomalies(toIntervals(small), { monthlyDutyCycle: null }).size).toBe(0);
  });

  it('signale un débit au-delà du volume maximal du constructeur', () => {
    const readings = [reading('2026-10-01T00:00:00Z', 0), reading('2026-10-11T00:00:00Z', 20000)];
    const anomalies = readingAnomalies(toIntervals(readings), { monthlyDutyCycle: 30000 });
    // 2 000 pages par jour, pour 1 000 au maximum.
    expect(anomalies.get(readings[1]!.id)![0]!.code).toBe('ABOVE_DUTY_CYCLE');
  });
});

describe('currentAnomalies', () => {
  const now = new Date('2026-11-04T12:00:00Z');

  it('signale une machine sans aucun relevé', () => {
    expect(currentAnomalies([], [], now).map((item) => item.code)).toEqual(['NO_RECENT_READING']);
  });

  it('signale un dernier relevé trop ancien', () => {
    const readings = [reading('2026-09-01T00:00:00Z', 100)];
    const [item] = currentAnomalies(readings, [], now);
    expect(item).toMatchObject({ code: 'NO_RECENT_READING', severity: 'info' });
    expect(item!.message).toBe('Dernier relevé il y a 64 jours.');
  });

  it('signale une machine en service qui n’imprime plus', () => {
    const readings = [
      reading('2026-09-20T00:00:00Z', 500),
      reading('2026-10-10T00:00:00Z', 500),
      reading('2026-11-01T00:00:00Z', 500),
    ];
    const codes = currentAnomalies(readings, toIntervals(readings), now).map((item) => item.code);
    expect(codes).toEqual(['NO_ACTIVITY']);
  });

  it('ne signale rien pour une machine relevée récemment et active', () => {
    const readings = [reading('2026-10-01T00:00:00Z', 0), reading('2026-11-01T00:00:00Z', 900)];
    expect(currentAnomalies(readings, toIntervals(readings), now)).toEqual([]);
  });
});
