import { CMYK_CHANNELS, CMYK_LABELS, type CmykChannel, type Coverage } from '@arksen/shared-types';
import { INK_CLASSES } from '@/features/consumption/consumption-ui';
import { cn } from '@/lib/utils';

const KEYS = {
  CYAN: 'cyan',
  MAGENTA: 'magenta',
  YELLOW: 'yellow',
  BLACK: 'black',
} as const satisfies Record<CmykChannel, keyof Coverage>;

const percent = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function formatCoverage(value: number): string {
  return `${percent.format(value)} %`;
}

/** Couverture de chaque encre : quatre barres sur une échelle de 0 à 100 %. */
export function CoverageBars({
  coverage,
  compact = false,
}: {
  coverage: Coverage;
  compact?: boolean;
}) {
  return (
    <div
      className={cn('grid grid-cols-4', compact ? 'w-28 gap-1' : 'w-full gap-2')}
      role="img"
      aria-label={CMYK_CHANNELS.map(
        (channel) => `${CMYK_LABELS[channel]} ${formatCoverage(coverage[KEYS[channel]])}`,
      ).join(', ')}
    >
      {CMYK_CHANNELS.map((channel) => {
        const value = coverage[KEYS[channel]];
        return (
          <div
            key={channel}
            className="min-w-0"
            title={`${CMYK_LABELS[channel]} : ${formatCoverage(value)}`}
          >
            <div className={cn('overflow-hidden rounded-full bg-muted', compact ? 'h-1.5' : 'h-2')}>
              <div
                className={cn('h-full rounded-full', INK_CLASSES[channel])}
                // Au moins un trait visible pour une couverture non nulle mais minime.
                style={{ width: value > 0 ? `${Math.max(3, Math.min(100, value))}%` : 0 }}
              />
            </div>
            {!compact && (
              <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                {formatCoverage(value)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
