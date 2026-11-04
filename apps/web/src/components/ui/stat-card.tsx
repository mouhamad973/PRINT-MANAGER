import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Unité affichée en plus petit après la valeur. */
  unit?: string;
  /** Ligne de contexte sous la valeur : variation, état, comparaison. */
  hint?: ReactNode;
  /** Carte vedette : un seul aplat de couleur par page, pour l'indicateur principal. */
  featured?: boolean;
  /** Page de détail. Sans lien, la flèche n'est pas affichée. */
  href?: string;
  /** Corps réduit, pour une valeur longue comme un montant. */
  compact?: boolean;
  className?: string;
}

/** Indicateur clé : libellé, grande valeur, contexte. */
export function StatCard({
  label,
  value,
  unit,
  hint,
  featured,
  href,
  compact,
  className,
}: StatCardProps) {
  return (
    <article
      className={cn(
        'relative flex min-h-40 flex-col rounded-2xl p-5',
        featured ? 'hero-surface' : 'border border-border/70 bg-surface shadow-panel',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3
          className={cn(
            'text-[15px] font-medium tracking-[-0.01em]',
            featured ? 'text-hero-foreground' : 'text-foreground',
          )}
        >
          {label}
        </h3>
        {href && (
          <Link
            href={href}
            aria-label={`Ouvrir : ${label}`}
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full transition-colors after:absolute after:inset-0 after:rounded-2xl',
              featured
                ? 'bg-hero-foreground text-[var(--hero-from)] hover:bg-hero-muted'
                : 'border border-border text-foreground hover:bg-muted',
            )}
          >
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>
      <p
        className={cn(
          'mt-auto pt-6 leading-none font-semibold tracking-[-0.035em] tabular-nums',
          compact ? 'text-[1.75rem]' : 'text-[2.5rem]',
          featured ? 'text-hero-foreground' : 'text-foreground',
        )}
      >
        {value}
        {unit && (
          <span
            className={cn(
              'ml-1 text-lg font-medium tracking-normal',
              featured ? 'text-hero-muted' : 'text-muted-foreground',
            )}
          >
            {unit}
          </span>
        )}
      </p>
      {hint && (
        <div
          className={cn(
            'mt-3 flex min-h-5 items-center gap-1.5 text-[13px]',
            featured ? 'text-hero-muted' : 'text-muted-foreground',
          )}
        >
          {hint}
        </div>
      )}
    </article>
  );
}
