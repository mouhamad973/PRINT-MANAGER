'use client';

import { ROLE_LABELS, ROLE_PERMISSIONS, TENANT_ROLES, type Permission } from '@arksen/shared-types';
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
const TENANT_PERMISSIONS: { permission: Permission; label: string }[] = [
  { permission: 'tenant:read', label: 'Consulter l’entreprise' },
  { permission: 'users:read', label: 'Voir les utilisateurs' },
  { permission: 'users:manage', label: 'Gérer les utilisateurs' },
  { permission: 'audit:read', label: 'Consulter le journal d’audit' },
];

function RolesMatrix() {
  return (
    <section className="space-y-3" aria-labelledby="roles-title">
      <div>
        <h2 id="roles-title" className="text-base font-semibold">
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
              <TableHead>Rôle</TableHead>
              {TENANT_PERMISSIONS.map(({ permission, label }) => (
                <TableHead key={permission} className="text-center">
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {TENANT_ROLES.map((role) => (
              <TableRow key={role}>
                <TableCell className="font-medium whitespace-nowrap">{ROLE_LABELS[role]}</TableCell>
                {TENANT_PERMISSIONS.map(({ permission, label }) => {
                  const granted = ROLE_PERMISSIONS[role].includes(permission);
                  return (
                    <TableCell key={permission} className="text-center">
                      {granted ? (
                        <Check
                          className="mx-auto size-4 text-success"
                          aria-label={`${label} : oui`}
                        />
                      ) : (
                        <span className="text-muted-foreground" aria-label={`${label} : non`}>
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
