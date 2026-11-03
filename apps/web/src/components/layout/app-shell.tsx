'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Bell, Menu, Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppSidebar } from './app-sidebar';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

function MobileNavigation() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Ouvrir le menu">
          <Menu aria-hidden="true" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw]"
        >
          <Dialog.Title className="sr-only">Navigation principale</Dialog.Title>
          <AppSidebar onNavigate={() => setOpen(false)} />
          <Dialog.Close asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Fermer le menu"
              className="absolute top-3.5 right-2 text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <X aria-hidden="true" />
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AppHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 lg:px-6">
      <MobileNavigation />
      {/* La recherche et les notifications s'activent avec les modules métier : elles restent désactivées d'ici là. */}
      <div className="relative max-w-md min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          disabled
          aria-label="Recherche"
          title="La recherche s’active avec le parc machines (phase 3)"
          placeholder="Machine, site, client…"
          className="pl-9"
        />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          disabled
          aria-label="Notifications"
          title="Les notifications s’activent avec les alertes (phase 8)"
        >
          <Bell aria-hidden="true" />
        </Button>
        <UserMenu />
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 lg:block">
        <AppSidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
