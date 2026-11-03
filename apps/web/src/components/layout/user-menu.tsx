'use client';

import { ROLE_LABELS } from '@arksen/shared-types';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useSession } from '@/features/session/session-provider';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

const itemClasses =
  'flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-[13px] outline-none data-[highlighted]:bg-muted';

export function UserMenu() {
  const { current, signOut } = useSession();
  const { user, tenant } = current;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Compte de ${user.name}`}
        className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-foreground hover:border-input"
      >
        {initials(user.name)}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-64 rounded-lg border border-border bg-surface p-1 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.3)]"
        >
          <div className="px-2 py-2">
            <p className="truncate font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
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
