'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const DAY_MS = 86_400_000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export interface Period {
  from: string;
  to: string;
}

/** Les 30 derniers jours, aujourd'hui compris. */
export function lastDays(days: number): Period {
  const to = new Date();
  return { from: isoDay(new Date(to.getTime() - (days - 1) * DAY_MS)), to: isoDay(to) };
}

function monthPeriod(offset: number): Period {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0));
  return { from: isoDay(start), to: isoDay(offset === 0 ? now : end) };
}

const PRESETS: Record<string, () => Period> = {
  '30': () => lastDays(30),
  '90': () => lastDays(90),
  month: () => monthPeriod(0),
  previous: () => monthPeriod(-1),
};

/** Choix d'une période : raccourcis, ou dates libres. */
export function PeriodPicker({
  value,
  onChange,
}: {
  value: Period;
  onChange: (period: Period) => void;
}) {
  const [preset, setPreset] = useState('30');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Période"
        className="w-auto min-w-44"
        value={preset}
        onChange={(event) => {
          setPreset(event.target.value);
          const make = PRESETS[event.target.value];
          if (make) onChange(make());
        }}
      >
        <option value="30">30 derniers jours</option>
        <option value="90">90 derniers jours</option>
        <option value="month">Mois en cours</option>
        <option value="previous">Mois précédent</option>
        <option value="custom">Dates choisies</option>
      </Select>
      {preset === 'custom' && (
        <>
          <Input
            type="date"
            aria-label="Du"
            className="w-auto"
            value={value.from}
            max={value.to}
            onChange={(event) =>
              event.target.value && onChange({ ...value, from: event.target.value })
            }
          />
          <Input
            type="date"
            aria-label="Au"
            className="w-auto"
            value={value.to}
            min={value.from}
            onChange={(event) =>
              event.target.value && onChange({ ...value, to: event.target.value })
            }
          />
        </>
      )}
    </div>
  );
}

export function money(value: number | null, currency: string, digits?: number): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    ...(digits !== undefined
      ? { minimumFractionDigits: digits, maximumFractionDigits: digits }
      : {}),
  }).format(value);
}

/** Coût d'une page : jusqu'à quatre décimales, car il se compte en fractions de la devise. */
export function pageCost(value: number | null, currency: string): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 4,
  }).format(value);
}
