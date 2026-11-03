import type { Permission } from '@arksen/shared-types';
import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'arksen:public';
export const PERMISSIONS_KEY = 'arksen:permissions';

/** Route accessible sans session. Toutes les autres exigent une session valide. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Permissions toutes requises pour accéder à la route. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
