import {
  ANOMALY_SEVERITIES,
  type AnomalyCode,
  type MeterAnomaly,
  type VolumeGranularity,
  type VolumePoint,
  type VolumeTotals,
} from '@arksen/shared-types';

/**
 * Analyse des compteurs, sans accès à la base : ce module ne reçoit que des relevés et rend
 * des volumes et des anomalies. Toutes les dates sont traitées en UTC.
 */

export const DAY_MS = 86_400_000;

/** Seuils de détection, réunis ici pour être ajustés et testés. */
export const THRESHOLDS = {
  /** Un intervalle dont le débit dépasse ce multiple de la médiane des précédents est un pic. */
  spikeFactor: 4,
  /** Nombre minimal d'intervalles précédents pour établir une médiane. */
  spikeMinHistory: 3,
  /** Volume minimal d'un pic, pour ne pas alerter sur quelques pages. */
  spikeMinPages: 300,
  /** Nombre d'intervalles précédents retenus pour la médiane. */
  spikeWindow: 10,
  /** Durée sans aucune page au-delà de laquelle une machine en service est signalée. */
  inactivityDays: 30,
  /** Âge du dernier relevé au-delà duquel il est réputé manquant. */
  staleReadingDays: 35,
} as const;

export interface Reading {
  id: string;
  readAt: Date;
  blackCount: number;
  colorCount: number | null;
  isReset: boolean;
}

export interface Interval {
  start: Date;
  end: Date;
  /** Relevé qui ferme l'intervalle. */
  readingId: string;
  /** Pages sur l'intervalle, ou `null` si elles ne peuvent pas être calculées. */
  pages: { black: number; color: number; total: number } | null;
  reason: 'ok' | 'reset' | 'decrease';
}

/** Intervalles entre relevés successifs. Les relevés doivent être triés par date croissante. */
export function toIntervals(readings: readonly Reading[]): Interval[] {
  const intervals: Interval[] = [];
  for (let index = 1; index < readings.length; index++) {
    const previous = readings[index - 1]!;
    const current = readings[index]!;
    const base = { start: previous.readAt, end: current.readAt, readingId: current.id };
    if (current.isReset) {
      intervals.push({ ...base, pages: null, reason: 'reset' });
      continue;
    }
    const black = current.blackCount - previous.blackCount;
    const color = (current.colorCount ?? 0) - (previous.colorCount ?? 0);
    if (black < 0 || color < 0) {
      intervals.push({ ...base, pages: null, reason: 'decrease' });
      continue;
    }
    intervals.push({ ...base, pages: { black, color, total: black + color }, reason: 'ok' });
  }
  return intervals;
}

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

interface Accumulator {
  black: number;
  color: number;
  covered: number;
  span: number;
}

/**
 * Répartit le volume de chaque intervalle à parts égales dans le temps, sur les jours de
 * `[from, to]` (bornes incluses, en jours UTC). Un jour sans aucun relevé qui l'encadre a une
 * couverture nulle : son volume est inconnu, et non pas nul.
 */
export function dailyVolumes(
  intervals: readonly Interval[],
  from: Date,
  to: Date,
): Map<string, Accumulator> {
  const days = new Map<string, Accumulator>();
  const first = utcDay(from);
  const last = utcDay(to);
  for (let day = first; day <= last; day += DAY_MS) {
    days.set(dayKey(day), { black: 0, color: 0, covered: 0, span: DAY_MS });
  }
  const rangeStart = first;
  const rangeEnd = last + DAY_MS;

  for (const interval of intervals) {
    if (!interval.pages) continue;
    const start = interval.start.getTime();
    const end = interval.end.getTime();
    const duration = end - start;
    if (duration <= 0) continue;
    const overlapStart = Math.max(start, rangeStart);
    const overlapEnd = Math.min(end, rangeEnd);
    for (let day = utcDay(new Date(overlapStart)); day < overlapEnd; day += DAY_MS) {
      const portionStart = Math.max(day, overlapStart);
      const portionEnd = Math.min(day + DAY_MS, overlapEnd);
      if (portionEnd <= portionStart) continue;
      const share = (portionEnd - portionStart) / duration;
      const entry = days.get(dayKey(day));
      if (!entry) continue;
      entry.black += interval.pages.black * share;
      entry.color += interval.pages.color * share;
      entry.covered += portionEnd - portionStart;
    }
  }
  return days;
}

function toTotals(entry: Accumulator): VolumeTotals {
  const black = Math.round(entry.black);
  const color = Math.round(entry.color);
  return {
    black,
    color,
    total: black + color,
    coverage:
      entry.span === 0 ? 0 : Math.min(1, Math.round((entry.covered / entry.span) * 1000) / 1000),
  };
}

function add(target: Accumulator, entry: Accumulator): void {
  target.black += entry.black;
  target.color += entry.color;
  target.covered += entry.covered;
  target.span += entry.span;
}

const empty = (): Accumulator => ({ black: 0, color: 0, covered: 0, span: 0 });

/** Série par jour ou par mois, et total de la période. Les arrondis ne se font qu'à la fin. */
export function volumeSeries(
  days: Map<string, Accumulator>,
  granularity: VolumeGranularity,
): { series: VolumePoint[]; totals: VolumeTotals } {
  const buckets = new Map<string, Accumulator>();
  const total = empty();
  for (const [day, entry] of days) {
    const key = granularity === 'day' ? day : day.slice(0, 7);
    const bucket = buckets.get(key) ?? empty();
    add(bucket, entry);
    buckets.set(key, bucket);
    add(total, entry);
  }
  return {
    series: [...buckets].map(([period, entry]) => ({ period, ...toTotals(entry) })),
    totals: toTotals(total),
  };
}

/** Somme de plusieurs cartes de jours (une par machine), pour les volumes du parc. */
export function mergeDays(
  target: Map<string, Accumulator>,
  source: Map<string, Accumulator>,
): void {
  for (const [day, entry] of source) {
    const current = target.get(day);
    if (!current) {
      target.set(day, { ...entry });
      continue;
    }
    current.black += entry.black;
    current.color += entry.color;
    current.covered += entry.covered;
    // La couverture du parc est la moyenne des couvertures des machines.
    current.span += entry.span;
  }
}

/** Totaux d'une période, pour une machine ou pour le parc. */
export function periodTotals(days: Map<string, Accumulator>): VolumeTotals {
  const total = empty();
  for (const entry of days.values()) add(total, entry);
  return toTotals(total);
}

function anomaly(
  code: AnomalyCode,
  message: string,
  readingId: string | null,
  at: Date,
): MeterAnomaly {
  return {
    code,
    severity: ANOMALY_SEVERITIES[code],
    message,
    readingId,
    detectedAt: at.toISOString(),
  };
}

const pagesFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Anomalies révélées par chaque relevé d'une machine (baisse de compteur, pic, dépassement constructeur). */
export function readingAnomalies(
  intervals: readonly Interval[],
  options: { monthlyDutyCycle: number | null },
): Map<string, MeterAnomaly[]> {
  const result = new Map<string, MeterAnomaly[]>();
  const rates: number[] = [];
  const push = (readingId: string, item: MeterAnomaly) => {
    result.set(readingId, [...(result.get(readingId) ?? []), item]);
  };

  for (const interval of intervals) {
    if (interval.reason === 'decrease') {
      push(
        interval.readingId,
        anomaly(
          'COUNTER_DECREASE',
          'Le compteur est inférieur au relevé précédent. Vérifiez la saisie, ou indiquez une remise à zéro si la carte a été remplacée.',
          interval.readingId,
          interval.end,
        ),
      );
      continue;
    }
    if (!interval.pages) continue;
    const days = (interval.end.getTime() - interval.start.getTime()) / DAY_MS;
    if (days <= 0) continue;
    const rate = interval.pages.total / days;

    if (options.monthlyDutyCycle && days >= 1 && rate > options.monthlyDutyCycle / 30) {
      push(
        interval.readingId,
        anomaly(
          'ABOVE_DUTY_CYCLE',
          `${pagesFormat.format(rate)} pages par jour, au-delà du volume maximal du constructeur (${pagesFormat.format(options.monthlyDutyCycle)} pages par mois).`,
          interval.readingId,
          interval.end,
        ),
      );
    }

    const history = rates.slice(-THRESHOLDS.spikeWindow);
    if (history.length >= THRESHOLDS.spikeMinHistory) {
      const reference = median(history);
      if (
        reference > 0 &&
        rate > reference * THRESHOLDS.spikeFactor &&
        interval.pages.total >= THRESHOLDS.spikeMinPages
      ) {
        push(
          interval.readingId,
          anomaly(
            'VOLUME_SPIKE',
            `${pagesFormat.format(rate)} pages par jour, contre ${pagesFormat.format(reference)} habituellement.`,
            interval.readingId,
            interval.end,
          ),
        );
      }
    }
    rates.push(rate);
  }
  return result;
}

/**
 * Anomalies de la machine à la date `now` : relevé manquant, et machine en service sans
 * aucune page depuis longtemps. Elles ne concernent que les machines en service.
 */
export function currentAnomalies(
  readings: readonly Reading[],
  intervals: readonly Interval[],
  now: Date,
): MeterAnomaly[] {
  const anomalies: MeterAnomaly[] = [];
  const last = readings.at(-1);
  if (!last) {
    anomalies.push(
      anomaly(
        'NO_RECENT_READING',
        'Aucun relevé de compteur n’a encore été enregistré.',
        null,
        now,
      ),
    );
    return anomalies;
  }
  const age = (now.getTime() - last.readAt.getTime()) / DAY_MS;
  if (age > THRESHOLDS.staleReadingDays) {
    anomalies.push(
      anomaly('NO_RECENT_READING', `Dernier relevé il y a ${Math.floor(age)} jours.`, last.id, now),
    );
  }

  // Durée continue, en remontant depuis le dernier relevé, sans aucune page imprimée.
  let idle = 0;
  for (let index = intervals.length - 1; index >= 0; index--) {
    const interval = intervals[index]!;
    if (!interval.pages || interval.pages.total > 0) break;
    idle += interval.end.getTime() - interval.start.getTime();
  }
  if (idle / DAY_MS >= THRESHOLDS.inactivityDays) {
    anomalies.push(
      anomaly(
        'NO_ACTIVITY',
        `Aucune page imprimée en ${Math.floor(idle / DAY_MS)} jours, alors que la machine est en service.`,
        last.id,
        last.readAt,
      ),
    );
  }
  return anomalies;
}
