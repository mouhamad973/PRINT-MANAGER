'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Bell, Menu, Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { IconButton } from '@/components/ui/button';
import { AppSidebar } from './app-sidebar';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

function MobileNavigation() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <IconButton className="lg:hidden" aria-label="Ouvrir le menu">
          <Menu aria-hidden="true" />
        </IconButton>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[oklch(0.15_0.02_165/0.45)] backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-3 left-3 z-50 w-72 max-w-[calc(100vw-1.5rem)]"
        >
          <Dialog.Title className="sr-only">Navigation principale</Dialog.Title>
          <AppSidebar onNavigate={() => setOpen(false)} />
          <Dialog.Close asChild>
            <IconButton aria-label="Fermer le menu" className="absolute top-6 right-4 size-9">
              <X aria-hidden="true" />
            </IconButton>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AppHeader() {
  return (
    <header className="sticky top-0 z-30 -mx-3 bg-background/85 px-3 pt-3 pb-3 backdrop-blur-md lg:top-0">
      <div className="flex h-16 items-center gap-2 rounded-2xl border border-border/70 bg-surface px-3 shadow-panel sm:gap-3 sm:px-4">
        <MobileNavigation />
        {/* La recherche et les notifications s'activent avec les modules métier : elles restent désactivées d'ici là. */}
        <div className="relative max-w-md min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            disabled
            aria-label="Recherche"
            title="La recherche s’active avec le parc machines (phase 3)"
            placeholder="Rechercher une machine, un site…"
            className="h-11 w-full rounded-full border border-transparent bg-surface-raised pr-4 pl-11 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <IconButton
            disabled
            aria-label="Notifications"
            title="Les notifications s’activent avec les alertes (phase 8)"
          >
            <Bell aria-hidden="true" />
          </IconButton>
          <span className="mx-1 hidden h-8 w-px bg-border sm:block" aria-hidden="true" />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh gap-3 px-3 lg:pb-3">
      <aside className="sticky top-3 hidden h-[calc(100dvh-1.5rem)] w-[272px] shrink-0 self-start lg:mt-3 lg:block">
        <AppSidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        <main className="mx-auto w-full max-w-7xl flex-1 px-1 pt-5 pb-10 sm:px-3 lg:px-5">
          {children}
        </main>
      </div>
    </div>
  );
}
