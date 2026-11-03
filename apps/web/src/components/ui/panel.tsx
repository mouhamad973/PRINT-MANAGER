import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Surface de contenu à bord fin : tableaux, formulaires, graphiques. */
export function Panel({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('overflow-hidden rounded-lg border border-border bg-surface', className)}
      {...props}
    />
  );
}
