import { Suspense } from 'react';
import { PaperPage } from '@/features/operations/paper-page';

export const metadata = { title: 'Papier' };

export default function PaperPageRoute() {
  return (
    <Suspense>
      <PaperPage />
    </Suspense>
  );
}
