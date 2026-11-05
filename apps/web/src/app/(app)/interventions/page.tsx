import { Suspense } from 'react';
import { InterventionsPage } from '@/features/operations/interventions-page';

export const metadata = { title: 'Interventions' };

export default function InterventionsPageRoute() {
  return (
    <Suspense>
      <InterventionsPage />
    </Suspense>
  );
}
