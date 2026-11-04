import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const fieldControlClasses =
  'h-10 w-full rounded-md border border-input bg-surface px-3.5 text-sm text-foreground transition-[border-color,box-shadow] placeholder:text-muted-foreground hover:border-muted-foreground/50 focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_18%,transparent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 aria-invalid:border-danger';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldControlClasses, className)} {...props} />;
}
