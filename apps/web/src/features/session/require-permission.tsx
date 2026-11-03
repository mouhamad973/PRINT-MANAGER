'use client';

import type { Permission } from '@arksen/shared-types';
import { ShieldOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSession } from './session-provider';

/** Masque une page que le rôle ne peut pas ouvrir. L'API refuserait de toute façon ses données. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { can } = useSession();
  if (can(permission)) {
    return children;
  }
  return (
    <div className="flex flex-col items-start gap-3 py-10" role="alert">
      <ShieldOff className="size-5 text-muted-foreground" aria-hidden="true" />
      <div>
        <h1 className="text-xl font-semibold">Accès non autorisé</h1>
        <p className="mt-1 max-w-[65ch] text-muted-foreground">
          Votre rôle ne donne pas accès à cette page. Si vous en avez besoin, demandez-le à
          l’administrateur de votre entreprise.
        </p>
      </div>
    </div>
  );
}
