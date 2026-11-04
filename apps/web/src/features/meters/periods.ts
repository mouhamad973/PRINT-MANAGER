/** Périodes de volumes, en jours UTC (bornes incluses), comme les calcule l'API. */

export const PERIOD_PRESETS = [
  { value: '30d', label: '30 derniers jours' },
  { value: '90d', label: '3 derniers mois' },
  { value: '12m', label: '12 derniers mois' },
  { value: 'month', label: 'Mois en cours' },
  { value: 'last-month', label: 'Mois précédent' },
  { value: 'year', label: 'Année en cours' },
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]['value'];

const DAY_MS = 86_400_000;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function today(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function periodRange(preset: PeriodPreset, now = new Date()): { from: string; to: string } {
  const end = today(now);
  const year = end.getUTCFullYear();
  const month = end.getUTCMonth();
  switch (preset) {
    case '30d':
      return { from: iso(new Date(end.getTime() - 29 * DAY_MS)), to: iso(end) };
    case '90d':
      return { from: iso(new Date(end.getTime() - 89 * DAY_MS)), to: iso(end) };
    case '12m':
      return { from: iso(new Date(Date.UTC(year, month - 11, 1))), to: iso(end) };
    case 'month':
      return { from: iso(new Date(Date.UTC(year, month, 1))), to: iso(end) };
    case 'last-month':
      return {
        from: iso(new Date(Date.UTC(year, month - 1, 1))),
        to: iso(new Date(Date.UTC(year, month, 0))),
      };
    case 'year':
      return { from: iso(new Date(Date.UTC(year, 0, 1))), to: iso(end) };
  }
}

const dayFormat = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const monthFormat = new Intl.DateTimeFormat('fr-FR', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
const rangeFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'UTC' });

/** Libellé d'un point de série : `AAAA-MM-JJ` ou `AAAA-MM`. */
export function periodLabel(period: string): string {
  return period.length === 7
    ? monthFormat.format(new Date(`${period}-01T00:00:00Z`))
    : dayFormat.format(new Date(`${period}T00:00:00Z`));
}

export function rangeLabel(from: string, to: string): string {
  return `du ${rangeFormat.format(new Date(`${from}T00:00:00Z`))} au ${rangeFormat.format(new Date(`${to}T00:00:00Z`))}`;
}

/** Variation entre deux volumes, ou `null` si la référence est nulle (pas de pourcentage infini). */
export function variation(current: number, previous: number): number | null {
  return previous === 0 ? null : (current - previous) / previous;
}
