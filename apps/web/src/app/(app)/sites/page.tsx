import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SitesPage } from '@/features/fleet/sites-page';
import { RequirePermission } from '@/features/session/require-permission';

export const metadata: Metadata = { title: 'Sites' };

export default function Page() {
  return (
    <RequirePermission permission="sites:read">
      {/* Le choix de l'entreprise passe par l'URL : useSearchParams exige une frontière Suspense. */}
      <Suspense>
        <SitesPage />
      </Suspense>
    </RequirePermission>
  );
}
