'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/features/session/session-provider';
import { cn } from '@/lib/utils';
import { BrandMark, ControlStrip } from './brand-mark';
import { navigationFor, type NavItem } from './navigation';

const itemClasses = 'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px]';

function SidebarItem({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const Icon = item.icon;

  if (!item.href) {
    return (
      <span
        className={cn(itemClasses, 'cursor-default text-sidebar-muted')}
        title={`Disponible en phase ${item.phase}`}
      >
        <Icon className="size-4 shrink-0 opacity-70" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <span className="text-[11px] tabular-nums opacity-80">P{item.phase}</span>
      </span>
    );
  }

  const active =
    item.href === '/'
      ? pathname === '/'
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        itemClasses,
        'font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent',
        active && 'bg-sidebar-accent',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </Link>
  );
}

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { current } = useSession();
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <ControlStrip />
      <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-4">
        <BrandMark />
      </div>
      <nav aria-label="Navigation principale" className="flex-1 space-y-5 overflow-y-auto p-3">
        {navigationFor(current).map((group) => (
          <div key={group.label}>
            <h2 className="mb-1 px-2.5 text-xs font-medium text-sidebar-muted">{group.label}</h2>
            <ul className="space-y-px">
              {group.items.map((item) => (
                <li key={item.label}>
                  <SidebarItem item={item} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
