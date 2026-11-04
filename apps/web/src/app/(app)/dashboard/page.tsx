import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DashboardPage } from '@/features/fleet/dashboard-page';
import { RequirePermission } from '@/features/session/require-permission';

export const metadata: Metadata = { title: 'Tableau de bord' };

export default function Page() {
  return (
    <RequirePermission permission="printers:read">
      {/* Le choix de l'entreprise passe par l'URL : useSearchParams exige une frontière Suspense. */}
      <Suspense>
        <DashboardPage />
      </Suspense>
    </RequirePermission>
  );
}
