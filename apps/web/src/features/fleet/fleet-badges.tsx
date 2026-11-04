import {
  COLOR_MODE_LABELS,
  CONNECTIVITY_LABELS,
  PRINTER_STATUS_LABELS,
  type ColorMode,
  type ConnectivityStatus,
  type PrinterStatus,
} from '@arksen/shared-types';
import { Badge, StatusDot } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_TONES = {
  ACTIVE: 'success',
  MAINTENANCE: 'warning',
  OUT_OF_SERVICE: 'danger',
  RETIRED: 'neutral',
} as const satisfies Record<PrinterStatus, string>;

export function PrinterStatusBadge({ status }: { status: PrinterStatus }) {
  return (
    <Badge tone={STATUS_TONES[status]}>
      <StatusDot />
      {PRINTER_STATUS_LABELS[status]}
    </Badge>
  );
}

const CONNECTIVITY_TONES = {
  UNKNOWN: 'neutral',
  ONLINE: 'success',
  OFFLINE: 'danger',
} as const satisfies Record<ConnectivityStatus, string>;

/** Connectivité relevée par l'agent. « Non mesurée » tant qu'aucune mesure n'existe : rien n'est simulé. */
export function ConnectivityBadge({ connectivity }: { connectivity: ConnectivityStatus }) {
  return (
    <Badge
      tone={CONNECTIVITY_TONES[connectivity]}
      title={
        connectivity === 'UNKNOWN'
          ? 'Mesurée par l’agent de collecte, disponible en phase 7'
          : undefined
      }
    >
      <StatusDot className={cn(connectivity === 'UNKNOWN' && 'opacity-50')} />
      {CONNECTIVITY_LABELS[connectivity]}
    </Badge>
  );
}

/** Pastilles CMJN pour un modèle couleur, une seule noire pour le noir et blanc. */
export function ColorModeTag({ colorMode }: { colorMode: ColorMode }) {
  const inks =
    colorMode === 'COLOR'
      ? [
          'bg-[var(--ink-cyan)]',
          'bg-[var(--ink-magenta)]',
          'bg-[var(--ink-yellow)]',
          'bg-[var(--ink-black)]',
        ]
      : ['bg-[var(--ink-black)]'];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap">
      <span className="flex -space-x-0.5" aria-hidden="true">
        {inks.map((ink) => (
          <span key={ink} className={cn('size-2.5 rounded-full ring-2 ring-surface', ink)} />
        ))}
      </span>
      {COLOR_MODE_LABELS[colorMode]}
    </span>
  );
}
