import type { Metadata } from 'next';
import { RequirePermission } from '@/features/session/require-permission';
import { AdministrationPage } from '@/features/system/administration-page';

export const metadata: Metadata = { title: 'Administration système' };

export default function Page() {
  return (
    <RequirePermission permission="platform:system:manage">
      <AdministrationPage />
    </RequirePermission>
  );
}
