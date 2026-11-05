import { MAINTENANCE_SOON_RATIO, type MaintenanceState } from '@arksen/shared-types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlanInput {
  intervalPages: number | null;
  intervalDays: number | null;
  /** Dernière maintenance faite, ou mise en place du plan. */
  lastDate: Date;
  lastCounter: number | null;
  /** Compteur total actuel de la machine. */
  counter: number | null;
  /** Rythme d'impression récent, pour estimer l'échéance d'un intervalle en pages. */
  pagesPerDay: number | null;
  now: Date;
}

export interface PlanStatus {
  pagesSince: number | null;
  daysSince: number;
  progress: number | null;
  state: MaintenanceState;
  dueAt: Date | null;
}

/**
 * État d'un plan de maintenance préventive : la part de l'intervalle déjà consommée, en pages
 * comme en jours ; la plus avancée l'emporte. À 90 %, la maintenance est à prévoir ; à 100 %,
 * elle est dépassée.
 */
export function planStatus(input: PlanInput): PlanStatus {
  const daysSince = Math.max(0, (input.now.getTime() - input.lastDate.getTime()) / DAY_MS);
  const pagesSince =
    input.counter !== null && input.lastCounter !== null
      ? Math.max(0, input.counter - input.lastCounter)
      : null;

  const ratios: number[] = [];
  const dues: Date[] = [];
  if (input.intervalDays) {
    ratios.push(daysSince / input.intervalDays);
    dues.push(new Date(input.lastDate.getTime() + input.intervalDays * DAY_MS));
  }
  if (input.intervalPages && pagesSince !== null) {
    ratios.push(pagesSince / input.intervalPages);
    const remaining = input.intervalPages - pagesSince;
    if (remaining <= 0) dues.push(input.now);
    else if (input.pagesPerDay && input.pagesPerDay > 0) {
      dues.push(new Date(input.now.getTime() + (remaining / input.pagesPerDay) * DAY_MS));
    }
  }

  const progress = ratios.length ? Math.max(...ratios) : null;
  let state: MaintenanceState = 'UNKNOWN';
  if (progress !== null) {
    state = progress >= 1 ? 'OVERDUE' : progress >= MAINTENANCE_SOON_RATIO ? 'DUE_SOON' : 'OK';
  }
  return {
    pagesSince,
    daysSince: Math.floor(daysSince),
    progress: progress === null ? null : Math.round(progress * 1000) / 1000,
    state,
    dueAt: dues.length ? new Date(Math.min(...dues.map((date) => date.getTime()))) : null,
  };
}
