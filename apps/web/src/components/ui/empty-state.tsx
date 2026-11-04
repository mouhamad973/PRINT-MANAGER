import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
}

/** État vide d'une liste : ce qui manque, et comment le créer. */
export function EmptyState({ icon: Icon, title, description, actions }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-4 p-6 sm:p-8">
      <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <div className="mt-1 max-w-[60ch] text-muted-foreground">{description}</div>
      </div>
      {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
    </div>
  );
}
