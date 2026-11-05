import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReportsPage } from '@/features/reports/reports-page';
import { RequirePermission } from '@/features/session/require-permission';

export const metadata: Metadata = { title: 'Rapports et statistiques' };

export default function Page() {
  return (
    <RequirePermission permission="meters:read">
      <Suspense>
        <ReportsPage />
      </Suspense>
    </RequirePermission>
  );
}
