import { cn } from '@/lib/utils';

/** Repère de calage d'imprimeur, signe de la marque. */
export function BrandMark({ inverted = false }: { inverted?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full',
          inverted
            ? 'bg-hero-foreground text-[var(--hero-from)]'
            : 'bg-primary text-primary-foreground',
        )}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-[22px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="5.5" />
          <path d="M12 2.5v19M2.5 12h19" />
        </svg>
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            'text-[17px] leading-tight font-semibold tracking-[-0.02em]',
            inverted ? 'text-hero-foreground' : 'text-foreground',
          )}
        >
          Arksen
        </p>
        <p
          className={cn(
            'text-xs leading-tight',
            inverted ? 'text-hero-muted' : 'text-muted-foreground',
          )}
        >
          Print Manager
        </p>
      </div>
    </div>
  );
}

/** Gamme de contrôle CMJN : le seul endroit où les quatre encres apparaissent hors des données. */
export function ControlStrip({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-1 gap-0.5', className)} aria-hidden="true">
      <span className="flex-1 rounded-full bg-[var(--ink-cyan)]" />
      <span className="flex-1 rounded-full bg-[var(--ink-magenta)]" />
      <span className="flex-1 rounded-full bg-[var(--ink-yellow)]" />
      <span className="flex-1 rounded-full bg-[oklch(0.1_0_0)] dark:bg-[oklch(0.55_0_0)]" />
    </div>
  );
}
