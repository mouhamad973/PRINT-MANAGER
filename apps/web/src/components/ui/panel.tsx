import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Panneau blanc flottant sur le canevas : tableaux, formulaires, graphiques. */
export function Panel({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-2xl border border-border/70 bg-surface shadow-panel',
        className,
      )}
      {...props}
    />
  );
}

interface PanelHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Titre de panneau, avec ses actions alignées à droite. */
export function PanelHeader({ title, description, actions, className }: PanelHeaderProps) {
  return (
    <div
      className={cn('flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4', className)}
    >
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
