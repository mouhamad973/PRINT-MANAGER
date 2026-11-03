import type { Metadata } from 'next';
import { AuditPage } from '@/features/audit/audit-page';
import { RequirePermission } from '@/features/session/require-permission';

export const metadata: Metadata = { title: 'Journal d’audit' };

export default function Page() {
  return (
    <RequirePermission permission="audit:read">
      <AuditPage />
    </RequirePermission>
  );
}
