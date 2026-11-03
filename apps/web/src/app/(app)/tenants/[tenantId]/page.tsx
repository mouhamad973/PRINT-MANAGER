import type { Metadata } from 'next';
import { RequirePermission } from '@/features/session/require-permission';
import { TenantDetailPage } from '@/features/tenants/tenant-detail-page';

export const metadata: Metadata = { title: 'Entreprise cliente' };

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return (
    <RequirePermission permission="platform:tenants:manage">
      <TenantDetailPage tenantId={tenantId} />
    </RequirePermission>
  );
}
