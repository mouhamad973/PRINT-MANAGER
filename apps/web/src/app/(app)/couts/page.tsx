import { Suspense } from 'react';
import { CostsPage } from '@/features/operations/costs-page';

export const metadata = { title: 'Coûts d’impression' };

export default function CostsPageRoute() {
  return (
    <Suspense>
      <CostsPage />
    </Suspense>
  );
}
