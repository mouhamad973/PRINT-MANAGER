import type { ForecastMethod, StockForecast } from '@arksen/shared-types';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Couverture visée par une commande, en plus du délai de réapprovisionnement. */
export const ORDER_COVER_DAYS = 30;

export interface LevelPoint {
  at: Date;
  level: number;
}

/**
 * Remontée de niveau d'une cartouche : un gain d'au moins 30 points jusqu'à 70 % ou plus.
 * Une telle hausse ne s'explique que par un remplacement (ou un recalibrage de la machine).
 */
export const JUMP_MIN_GAIN = 30;
export const JUMP_MIN_LEVEL = 70;

export function detectJumps(points: LevelPoint[]): { at: Date; before: number; after: number }[] {
  const sorted = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const jumps = [];
  for (let index = 1; index < sorted.length; index++) {
    const before = sorted[index - 1]!;
    const after = sorted[index]!;
    if (after.level - before.level >= JUMP_MIN_GAIN && after.level >= JUMP_MIN_LEVEL) {
      jumps.push({ at: after.at, before: before.level, after: after.level });
    }
  }
  return jumps;
}

/**
 * Tendance du niveau depuis la dernière remontée : pente par moindres carrés, en points par
 * jour. Il faut au moins deux mesures espacées d'un jour ; une pente nulle ou positive ne
 * prévoit rien.
 */
export function levelTrend(
  points: LevelPoint[],
  now: Date,
): { percentPerDay: number | null; emptyAt: Date | null } {
  const sorted = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const lastJump = detectJumps(sorted).at(-1);
  const segment = lastJump ? sorted.filter((point) => point.at >= lastJump.at) : sorted;
  if (segment.length < 2) return { percentPerDay: null, emptyAt: null };
  const first = segment[0]!.at.getTime();
  const span = segment.at(-1)!.at.getTime() - first;
  if (span < DAY_MS) return { percentPerDay: null, emptyAt: null };

  const xs = segment.map((point) => (point.at.getTime() - first) / DAY_MS);
  const ys = segment.map((point) => point.level);
  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
  let covariance = 0;
  let variance = 0;
  xs.forEach((x, index) => {
    covariance += (x - meanX) * (ys[index]! - meanY);
    variance += (x - meanX) ** 2;
  });
  const slope = covariance / variance;
  if (!(slope < 0)) return { percentPerDay: null, emptyAt: null };

  const current = segment.at(-1)!;
  const days = current.level / -slope;
  return {
    percentPerDay: round(-slope, 3),
    emptyAt: new Date(Math.max(current.at.getTime() + days * DAY_MS, now.getTime())),
  };
}

export interface ForecastInput {
  quantity: number;
  minQuantity: number;
  leadTimeDays: number;
  /** Cartouches par jour selon le moteur CMJN, nul s'il n'a rien estimé. */
  engineRate: number | null;
  /** Cartouches installées depuis ce stock sur la fenêtre, et sa durée en jours. */
  installations: number;
  windowDays: number;
  now: Date;
}

/**
 * Prévision d'un article : le rythme vient du moteur CMJN (pages réellement imprimées par les
 * machines équipées, aplat et calibration) ; à défaut, de l'historique des installations.
 */
export function stockForecast(input: ForecastInput): StockForecast {
  const historyRate = input.installations > 0 ? input.installations / input.windowDays : null;
  let method: ForecastMethod = 'none';
  let rate: number | null = null;
  if (input.engineRate !== null && input.engineRate > 0) {
    method = 'engine';
    rate = input.engineRate;
  } else if (historyRate !== null) {
    method = 'history';
    rate = historyRate;
  }

  const target = Math.max(
    rate === null ? 0 : Math.ceil(rate * (input.leadTimeDays + ORDER_COVER_DAYS)),
    input.minQuantity > 0 ? input.minQuantity + 1 : 0,
  );
  const recommendedOrder = Math.max(0, target - input.quantity);

  if (rate === null) {
    return {
      method,
      cartridgesPerDay: null,
      daysOfCover: null,
      stockoutAt: null,
      recommendedOrder,
    };
  }
  const daysOfCover = input.quantity / rate;
  return {
    method,
    cartridgesPerDay: round(rate, 4),
    daysOfCover: round(daysOfCover, 1),
    stockoutAt: new Date(input.now.getTime() + daysOfCover * DAY_MS).toISOString(),
    recommendedOrder,
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
