import type { Metadata } from 'next';
import { RequirePermission } from '@/features/session/require-permission';
import { UsersPage } from '@/features/users/users-page';

export const metadata: Metadata = { title: 'Utilisateurs et permissions' };

export default function Page() {
  return (
    <RequirePermission permission="users:read">
      <UsersPage />
    </RequirePermission>
  );
}
