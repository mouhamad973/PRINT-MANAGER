'use client';

import {
  PERMISSION_LABELS,
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  TENANT_ROLES,
  type Permission,
} from '@arksen/shared-types';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { Panel } from '@/components/ui/panel';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSession } from '@/features/session/session-provider';
import { UsersPanel } from './users-panel';

/** Droits d'entreprise affichés dans la matrice. Les droits de plateforme n'y figurent pas. */
const TENANT_PERMISSIONS = PERMISSIONS.filter(
  (permission): permission is Permission => !permission.startsWith('platform:'),
).map((permission) => ({ permission, label: PERMISSION_LABELS[permission] ?? permission }));

function RolesMatrix() {
  return (
    <section className="space-y-3" aria-labelledby="roles-title">
      <div>
        <h2 id="roles-title" className="text-lg font-semibold tracking-[-0.015em]">
          Rôles et permissions
        </h2>
        <p className="mt-1 max-w-[65ch] text-muted-foreground">
          Les droits de chaque rôle sont fixés par la plateforme. Les modules à venir ajouteront les
          leurs.
        </p>
      </div>
      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Droit</TableHead>
              {TENANT_ROLES.map((role) => (
                <TableHead key={role} className="text-center">
                  {ROLE_LABELS[role]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {TENANT_PERMISSIONS.map(({ permission, label }) => (
              <TableRow key={permission}>
                <TableCell className="font-medium">{label}</TableCell>
                {TENANT_ROLES.map((role) => {
                  const granted = ROLE_PERMISSIONS[role].includes(permission);
                  const text = `${ROLE_LABELS[role]}, ${label}`;
                  return (
                    <TableCell key={role} className="text-center">
                      {granted ? (
                        <Check
                          className="mx-auto size-4 text-success"
                          aria-label={`${text} : oui`}
                        />
                      ) : (
                        <span className="text-muted-foreground" aria-label={`${text} : non`}>
                          —
                        </span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </section>
  );
}

export function UsersPage() {
  const { current } = useSession();

  if (!current.tenant) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Utilisateurs et permissions"
          description={
            <>
              Votre compte de plateforme n’appartient à aucune entreprise. Les utilisateurs se
              gèrent depuis la fiche de chaque{' '}
              <Link href="/tenants" className="text-primary underline">
                entreprise cliente
              </Link>
              .
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Utilisateurs et permissions"
        description={`Comptes de ${current.tenant.name}. Chaque utilisateur n’accède qu’aux données de cette entreprise.`}
      />
      <UsersPanel tenantId={current.tenant.id} />
      <RolesMatrix />
    </div>
  );
}
