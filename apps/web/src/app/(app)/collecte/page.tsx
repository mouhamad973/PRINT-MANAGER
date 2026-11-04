import { Suspense } from 'react';
import { CollectorPage } from '@/features/collector/collector-page';

export const metadata = { title: 'Agents de collecte' };

export default function CollectorRoute() {
  return (
    <Suspense>
      <CollectorPage />
    </Suspense>
  );
}
