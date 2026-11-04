'use client';

import {
  ANOMALY_LABELS,
  type AnomalySeverity,
  type MeterAnomaly,
  type VolumePoint,
} from '@arksen/shared-types';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, StatusDot } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { periodLabel, variation } from './periods';

export const numberFormat = new Intl.NumberFormat('fr-FR');
const percentFormat = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 0,
});
const signedPercent = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});

export function formatPercent(value: number): string {
  return percentFormat.format(value);
}

const SEVERITY_TONES = {
  danger: 'danger',
  warning: 'warning',
  info: 'neutral',
} as const satisfies Record<AnomalySeverity, string>;

export function AnomalyBadge({
  anomaly,
}: {
  anomaly: Pick<MeterAnomaly, 'code' | 'severity' | 'message'>;
}) {
  return (
    <Badge tone={SEVERITY_TONES[anomaly.severity]} title={anomaly.message}>
      <StatusDot />
      {ANOMALY_LABELS[anomaly.code]}
    </Badge>
  );
}

/**
 * Variation entre deux périodes. Une hausse n'est ni bonne ni mauvaise en soi : la couleur reste
 * neutre, seule la flèche indique le sens.
 */
export function Variation({
  current,
  previous,
  className,
}: {
  current: number;
  previous: number;
  className?: string;
}) {
  const ratio = variation(current, previous);
  if (ratio === null) {
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }
  const Icon = ratio >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-medium tabular-nums', className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {signedPercent.format(ratio)}
    </span>
  );
}

/** Volumes empilés : noir et blanc à l'encre noire, couleur en vert. Un point sans relevé n'est pas tracé. */
export function VolumeChart({ series, height = 260 }: { series: VolumePoint[]; height?: number }) {
  const data = series.map((point) => ({
    label: periodLabel(point.period),
    black: point.coverage > 0 ? point.black : null,
    color: point.coverage > 0 ? point.color : null,
    coverage: point.coverage,
  }));
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            minTickGap={16}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            allowDecimals={false}
            tickFormatter={(value: number) => numberFormat.format(value)}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)', radius: 6 }}
            formatter={(value, name) => [
              `${numberFormat.format(Number(value))} pages`,
              name === 'black' ? 'Noir et blanc' : 'Couleur',
            ]}
            labelFormatter={(label, payload) => {
              const coverage = payload?.[0]?.payload?.coverage as number | undefined;
              return coverage !== undefined && coverage < 1
                ? `${label} · relevés sur ${formatPercent(coverage)} de la période`
                : String(label);
            }}
            contentStyle={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              borderRadius: 12,
              color: 'var(--foreground)',
              fontSize: 13,
            }}
          />
          <Bar
            dataKey="black"
            stackId="pages"
            fill="var(--ink-black)"
            radius={[0, 0, 4, 4]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="color"
            stackId="pages"
            fill="var(--chart-2)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChartLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-[var(--ink-black)]" aria-hidden="true" />
        Noir et blanc
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-[var(--chart-2)]" aria-hidden="true" />
        Couleur
      </span>
    </div>
  );
}

/** Explication du calcul, à côté de chaque volume. */
export function CoverageNote({ coverage }: { coverage: number }) {
  return (
    <p className="text-xs text-muted-foreground">
      Volumes calculés entre deux relevés, répartis à parts égales dans le temps.
      {coverage < 1 &&
        ` Les relevés couvrent ${formatPercent(coverage)} de la période : le reste est inconnu, et non pas nul.`}
    </p>
  );
}
