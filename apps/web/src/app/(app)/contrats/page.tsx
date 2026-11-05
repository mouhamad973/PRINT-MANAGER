import { Suspense } from 'react';
import { ContractsPage } from '@/features/operations/contracts-page';

export const metadata = { title: 'Contrats' };

export default function ContractsPageRoute() {
  return (
    <Suspense>
      <ContractsPage />
    </Suspense>
  );
}
