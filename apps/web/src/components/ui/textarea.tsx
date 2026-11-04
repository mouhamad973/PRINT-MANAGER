import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { fieldControlClasses } from './input';

export function Textarea({ className, rows = 3, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      rows={rows}
      className={cn(
        fieldControlClasses,
        'h-auto min-h-20 resize-y py-2.5 leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}
