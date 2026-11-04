import {
  ALERT_TYPE_LABELS,
  STOCK_LEVEL_LABELS,
  type Alert,
  type StockForecast,
  type StockLevel,
} from '@arksen/shared-types';
import { Badge, StatusDot } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';

const LEVEL_TONES = { OK: 'success', LOW: 'warning', OUT: 'danger' } as const satisfies Record<
  StockLevel,
  string
>;

export function StockLevelBadge({ level }: { level: StockLevel }) {
  return (
    <Badge tone={LEVEL_TONES[level]}>
      <StatusDot />
      {STOCK_LEVEL_LABELS[level]}
    </Badge>
  );
}

export const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function formatAmount(value: number | null, currency: string): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
}

const METHOD_LABELS: Record<StockForecast['method'], string> = {
  engine: 'Moteur CMJN : pages relevées, aplat et calibration des machines équipées',
  history: 'Historique des installations depuis ce stock',
  none: 'Aucune consommation observée sur 90 jours',
};

/** Couverture et rupture prévue, avec la méthode de calcul en infobulle. */
export function ForecastCell({ forecast }: { forecast: StockForecast }) {
  if (forecast.daysOfCover === null || forecast.stockoutAt === null) {
    return (
      <span className="text-muted-foreground" title={METHOD_LABELS[forecast.method]}>
        Pas de consommation observée
      </span>
    );
  }
  return (
    <span title={METHOD_LABELS[forecast.method]}>
      {forecast.daysOfCover < 1
        ? 'Moins d’un jour'
        : `${decimal.format(forecast.daysOfCover)} jours`}
      <span className="block text-xs text-muted-foreground">
        Rupture vers le {formatDate(forecast.stockoutAt)} ·{' '}
        {forecast.method === 'engine' ? 'moteur CMJN' : 'historique'}
      </span>
    </span>
  );
}

export function AlertSeverityBadge({ alert }: { alert: Pick<Alert, 'severity' | 'type'> }) {
  return (
    <Badge tone={alert.severity === 'CRITICAL' ? 'danger' : 'warning'}>
      <StatusDot />
      {ALERT_TYPE_LABELS[alert.type]}
    </Badge>
  );
}
