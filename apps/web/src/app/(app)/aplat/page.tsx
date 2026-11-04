import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SimulatorPage } from '@/features/consumption/simulator-page';
import { RequirePermission } from '@/features/session/require-permission';

export const metadata: Metadata = { title: 'Aplat CMJN' };

export default function Page() {
  return (
    <RequirePermission permission="consumption:read">
      {/* Le choix de l'entreprise passe par l'URL : useSearchParams exige une frontière Suspense. */}
      <Suspense>
        <SimulatorPage />
      </Suspense>
    </RequirePermission>
  );
}
