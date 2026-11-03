import type { TenantStatus, UserStatus } from '@arksen/shared-types';
import { Badge } from './badge';

const LABELS: Record<TenantStatus | UserStatus, string> = {
  ACTIVE: 'Actif',
  SUSPENDED: 'Suspendue',
  DISABLED: 'Désactivé',
};

export function StatusBadge({ status }: { status: TenantStatus | UserStatus }) {
  return <Badge tone={status === 'ACTIVE' ? 'success' : 'danger'}>{LABELS[status]}</Badge>;
}
