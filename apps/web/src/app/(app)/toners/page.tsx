import { Suspense } from 'react';
import { TonersPage } from '@/features/stocks/toners-page';

export const metadata = { title: 'Toners' };

export default function TonersPageRoute() {
  return (
    <Suspense>
      <TonersPage />
    </Suspense>
  );
}
