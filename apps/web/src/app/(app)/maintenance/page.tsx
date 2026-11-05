import { Suspense } from 'react';
import { MaintenancePage } from '@/features/operations/maintenance-page';

export const metadata = { title: 'Maintenance' };

export default function MaintenancePageRoute() {
  return (
    <Suspense>
      <MaintenancePage />
    </Suspense>
  );
}
