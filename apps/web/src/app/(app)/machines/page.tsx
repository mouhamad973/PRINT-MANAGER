import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PrintersPage } from '@/features/fleet/printers-page';
import { RequirePermission } from '@/features/session/require-permission';

export const metadata: Metadata = { title: 'Machines' };

export default function Page() {
  return (
    <RequirePermission permission="printers:read">
      {/* Le choix de l'entreprise passe par l'URL : useSearchParams exige une frontière Suspense. */}
      <Suspense>
        <PrintersPage />
      </Suspense>
    </RequirePermission>
  );
}
