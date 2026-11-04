import { Suspense } from 'react';
import { PrintJobsPage } from '@/features/print-jobs/print-jobs-page';

export const metadata = { title: 'Analyse PDF' };

export default function AnalysesRoute() {
  return (
    <Suspense>
      <PrintJobsPage />
    </Suspense>
  );
}
