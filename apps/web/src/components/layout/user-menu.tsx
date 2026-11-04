'use client';

import { ROLE_LABELS } from '@arksen/shared-types';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useSession } from '@/features/session/session-provider';

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

const itemClasses =
  'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none data-[highlighted]:bg-muted';

export function UserMenu() {
  const { current, signOut } = useSession();
  const { user, tenant } = current;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Compte de ${user.name}`}
        className="group flex shrink-0 cursor-pointer items-center gap-3 rounded-full p-0.5 text-left outline-none hover:bg-muted sm:pr-3"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary-soft-foreground">
          {initials(user.name)}
        </span>
        <span className="hidden min-w-0 md:block">
          <span className="block max-w-44 truncate text-sm leading-tight font-semibold">
            {user.name}
          </span>
          <span className="block max-w-44 truncate text-xs leading-tight text-muted-foreground">
            {user.email}
          </span>
        </span>
        <ChevronDown
          className="hidden size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 sm:block"
          aria-hidden="true"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-64 rounded-xl border border-border/70 bg-surface p-1.5 shadow-overlay"
        >
          <div className="px-2.5 py-2">
            <p className="truncate font-semibold">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {ROLE_LABELS[user.role]}
              {tenant && <> · {tenant.name}</>}
            </p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item asChild className={itemClasses}>
            <Link href="/profile">
              <UserRound className="size-4" aria-hidden="true" />
              Mon profil
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClasses} onSelect={() => void signOut()}>
            <LogOut className="size-4" aria-hidden="true" />
            Se déconnecter
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
