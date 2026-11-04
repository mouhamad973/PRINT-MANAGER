import { Suspense } from 'react';
import { AlertsPage } from '@/features/stocks/alerts-page';

export const metadata = { title: 'Alertes' };

export default function AlertsPageRoute() {
  return (
    <Suspense>
      <AlertsPage />
    </Suspense>
  );
}
