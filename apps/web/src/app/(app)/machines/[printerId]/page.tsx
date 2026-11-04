import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PrinterDetailPage } from '@/features/fleet/printer-detail-page';
import { RequirePermission } from '@/features/session/require-permission';

export const metadata: Metadata = { title: 'Machine' };

export default async function Page({ params }: { params: Promise<{ printerId: string }> }) {
  const { printerId } = await params;
  return (
    <RequirePermission permission="printers:read">
      <Suspense>
        <PrinterDetailPage printerId={printerId} />
      </Suspense>
    </RequirePermission>
  );
}
