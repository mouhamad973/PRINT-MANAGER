import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ModelsPage } from '@/features/fleet/models-page';
import { RequirePermission } from '@/features/session/require-permission';

export const metadata: Metadata = { title: 'Fiches techniques' };

export default function Page() {
  return (
    <RequirePermission permission="printers:read">
      {/* Le choix de l'entreprise passe par l'URL : useSearchParams exige une frontière Suspense. */}
      <Suspense>
        <ModelsPage />
      </Suspense>
    </RequirePermission>
  );
}
