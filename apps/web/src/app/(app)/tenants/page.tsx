import type { Metadata } from 'next';
import { RequirePermission } from '@/features/session/require-permission';
import { TenantsPage } from '@/features/tenants/tenants-page';

export const metadata: Metadata = { title: 'Entreprises clientes' };

export default function Page() {
  return (
    <RequirePermission permission="platform:tenants:manage">
      <TenantsPage />
    </RequirePermission>
  );
}
