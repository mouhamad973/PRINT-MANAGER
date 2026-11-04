import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ConsumptionPage } from '@/features/consumption/consumption-page';
import { RequirePermission } from '@/features/session/require-permission';

export const metadata: Metadata = { title: 'Consommation toner' };

export default function Page() {
  return (
    <RequirePermission permission="consumption:read">
      {/* Le choix de l'entreprise passe par l'URL : useSearchParams exige une frontière Suspense. */}
      <Suspense>
        <ConsumptionPage />
      </Suspense>
    </RequirePermission>
  );
}
