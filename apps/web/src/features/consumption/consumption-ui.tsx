'use client';

import {
  CALIBRATION_SOURCE_LABELS,
  CMYK_LABELS,
  CONFIDENCE_LABELS,
  type Calibration,
  type CmykChannel,
} from '@arksen/shared-types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Les encres CMJN : ici, elles désignent bien un canal de données. */
export const INK_CLASSES: Record<CmykChannel, string> = {
  CYAN: 'bg-[var(--ink-cyan)]',
  MAGENTA: 'bg-[var(--ink-magenta)]',
  YELLOW: 'bg-[var(--ink-yellow)]',
  BLACK: 'bg-[var(--ink-black)]',
};

export const INK_VARS: Record<CmykChannel, string> = {
  CYAN: 'var(--ink-cyan)',
  MAGENTA: 'var(--ink-magenta)',
  YELLOW: 'var(--ink-yellow)',
  BLACK: 'var(--ink-black)',
};

export function InkLabel({ channel, className }: { channel: CmykChannel; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 whitespace-nowrap', className)}>
      <span
        className={cn('size-2.5 shrink-0 rounded-full', INK_CLASSES[channel])}
        aria-hidden="true"
      />
      {CMYK_LABELS[channel]}
    </span>
  );
}

const grams = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const precise = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
const coefficientFormat = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});
const percent = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});

export function formatGrams(value: number): string {
  return value < 10 ? `${precise.format(value)} g` : `${grams.format(value)} g`;
}

export function formatSignedPercent(value: number): string {
  return percent.format(value);
}

/** Montant dans la devise de l'entreprise ; le coût par page garde plus de décimales. */
export function formatMoney(value: number | null, currency: string, perPage = false): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    // Les totaux suivent la devise (aucune décimale en franc CFA) ; un coût par page en garde quatre.
    ...(perPage ? { minimumFractionDigits: 2, maximumFractionDigits: 4 } : {}),
  }).format(value);
}

const CONFIDENCE_TONES = {
  none: 'neutral',
  low: 'warning',
  medium: 'brand',
  high: 'success',
} as const;

export function CalibrationBadge({ calibration }: { calibration: Calibration }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-medium tabular-nums">
        × {coefficientFormat.format(calibration.coefficient)}
      </span>
      <Badge
        tone={CONFIDENCE_TONES[calibration.confidence]}
        title={`${CALIBRATION_SOURCE_LABELS[calibration.source]} · ${calibration.observations} mesure${calibration.observations > 1 ? 's' : ''}`}
      >
        {calibration.source === 'manual' ? 'Manuel' : CONFIDENCE_LABELS[calibration.confidence]}
      </Badge>
    </span>
  );
}

/** Rappel des trois natures de valeur, qui ne doivent jamais être confondues. */
export function OriginLegend() {
  return (
    <dl className="grid gap-3 text-[13px] sm:grid-cols-3">
      <div>
        <dt className="font-semibold">Théorique</dt>
        <dd className="text-muted-foreground">
          Calculée par le moteur : rendement constructeur, aplat et pages imprimées.
        </dd>
      </div>
      <div>
        <dt className="font-semibold">Estimée</dt>
        <dd className="text-muted-foreground">
          La théorique corrigée par la calibration, apprise des consommations réelles.
        </dd>
      </div>
      <div>
        <dt className="font-semibold">Réelle</dt>
        <dd className="text-muted-foreground">
          Mesurée par pesée, ou estimée d’après les cartouches vidées. Jamais un niveau SNMP.
        </dd>
      </div>
    </dl>
  );
}
