import { Suspense } from 'react';
import { ImpressionsPage } from '@/features/operations/impressions-page';

export const metadata = { title: 'Impressions' };

export default function ImpressionsPageRoute() {
  return (
    <Suspense>
      <ImpressionsPage />
    </Suspense>
  );
}
