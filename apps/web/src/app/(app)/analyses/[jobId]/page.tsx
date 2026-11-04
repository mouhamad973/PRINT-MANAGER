import { Suspense } from 'react';
import { PrintJobReport } from '@/features/print-jobs/print-job-report';

export const metadata = { title: 'Rapport de préproduction' };

export default async function AnalysisReportRoute({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return (
    <Suspense>
      <PrintJobReport jobId={jobId} />
    </Suspense>
  );
}
