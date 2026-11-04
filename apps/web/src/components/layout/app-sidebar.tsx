'use client';

import { Building2, LogOut, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/features/session/session-provider';
import { cn } from '@/lib/utils';
import { BrandMark, ControlStrip } from './brand-mark';
import { navigationFor, type NavItem } from './navigation';

const itemClasses =
  'relative flex h-10 items-center gap-3 rounded-md px-3 text-[14px] transition-colors';

function SidebarItem({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const Icon = item.icon;

  if (!item.href) {
    return (
      <span
        className={cn(itemClasses, 'cursor-default text-sidebar-muted')}
        title={`Disponible en phase ${item.phase}`}
      >
        <Icon className="size-[18px] shrink-0 opacity-60" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <span className="rounded-full border border-border px-1.5 text-[10px] leading-4 font-medium tabular-nums">
          P{item.phase}
        </span>
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
        active
          ? 'font-semibold text-sidebar-foreground before:absolute before:top-1/2 before:-left-3 before:h-7 before:w-1 before:-translate-y-1/2 before:rounded-r-full before:bg-primary'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
      )}
    >
      <Icon
        className={cn('size-[18px] shrink-0', active && 'text-primary')}
        strokeWidth={active ? 2.25 : 2}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </Link>
  );
}

/** Périmètre de la session : l'entreprise du compte, ou la plateforme pour un Super Administrateur. */
function OrganizationCard() {
  const { current } = useSession();
  const Icon = current.tenant ? Building2 : ShieldCheck;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-surface-raised p-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground">
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-medium tracking-[0.08em] text-sidebar-muted uppercase">
          {current.tenant ? 'Organisation' : 'Plateforme'}
        </p>
        <p className="line-clamp-2 text-[13px] leading-snug font-semibold">
          {current.tenant?.name ?? 'Arksen, tous les clients'}
        </p>
      </div>
    </div>
  );
}

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { current, signOut } = useSession();
  return (
    <div className="flex h-full flex-col rounded-2xl border border-border/70 bg-sidebar text-sidebar-foreground shadow-panel">
      <div className="space-y-5 px-5 pt-6 pb-4">
        <BrandMark />
        <OrganizationCard />
      </div>
      <nav
        aria-label="Navigation principale"
        className="flex-1 space-y-6 overflow-y-auto px-3 pt-2 pb-4"
      >
        {navigationFor(current).map((group) => (
          <div key={group.label}>
            <h2 className="mb-1.5 flex items-center gap-3 px-3 text-[11px] font-medium tracking-[0.08em] text-sidebar-muted uppercase">
              {group.label}
              <span className="h-px flex-1 bg-sidebar-border" aria-hidden="true" />
            </h2>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.label}>
                  <SidebarItem item={item} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="space-y-3 border-t border-sidebar-border px-3 pt-3 pb-4">
        <button
          type="button"
          onClick={() => void signOut()}
          className={cn(
            itemClasses,
            'w-full cursor-pointer text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
          )}
        >
          <LogOut className="size-[18px] shrink-0" aria-hidden="true" />
          Se déconnecter
        </button>
        <ControlStrip className="mx-3" />
      </div>
    </div>
  );
}
