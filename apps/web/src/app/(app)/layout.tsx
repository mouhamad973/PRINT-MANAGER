import type { ReactNode } from 'react';
import { ControlStrip } from '@/components/layout/brand-mark';
import { AppShell } from '@/components/layout/app-shell';
import { SessionProvider } from '@/features/session/session-provider';

function SessionLoading() {
  return (
    <div className="min-h-dvh" role="status" aria-label="Chargement de la session">
      <ControlStrip />
    </div>
  );
}

/** Toutes les pages de ce groupe exigent une session, vérifiée par l'API avant affichage. */
export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider fallback={<SessionLoading />}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
