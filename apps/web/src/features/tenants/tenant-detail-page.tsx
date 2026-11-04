'use client';

import type { Tenant } from '@arksen/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormError } from '@/components/ui/field';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { useSession } from '@/features/session/session-provider';
import { UsersPanel } from '@/features/users/users-panel';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { TenantForm } from './tenant-form';

export function TenantDetailPage({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const canManage = can('platform:tenants:manage');
  const [confirmingStatus, setConfirmingStatus] = useState(false);
  const [saved, setSaved] = useState(false);

  const tenant = useQuery({
    queryKey: ['tenants', tenantId],
    queryFn: () => apiFetch<Tenant>(`/tenants/${tenantId}`),
    retry: false,
  });

  const update = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      apiFetch<Tenant>(`/tenants/${tenantId}`, { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['tenants', tenantId], updated);
      await queryClient.invalidateQueries({ queryKey: ['tenants'], exact: false });
    },
  });

  if (tenant.isPending) {
    return (
      <div className="space-y-4" role="status" aria-label="Chargement de l’entreprise">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (tenant.isError) {
    const notFound = tenant.error instanceof ApiError && tenant.error.status === 404;
    return (
      <div className="space-y-4">
        <PageHeader title={notFound ? 'Entreprise introuvable' : 'Chargement impossible'} />
        <FormError
          message={
            notFound
              ? 'Cette entreprise n’existe pas ou ne vous est pas accessible.'
              : tenant.error.message
          }
        />
      </div>
    );
  }

  const data = tenant.data;
  const suspended = data.status === 'SUSPENDED';

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        {canManage && (
          <Link
            href="/tenants"
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Entreprises clientes
          </Link>
        )}
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-3">
              {data.name}
              <StatusBadge status={data.status} />
            </span>
          }
          description={`Identifiant ${data.slug} · créée le ${formatDate(data.createdAt)}`}
          actions={
            canManage && (
              <Button
                variant={suspended ? 'primary' : 'danger'}
                onClick={() => setConfirmingStatus(true)}
              >
                {suspended ? 'Réactiver l’entreprise' : 'Suspendre l’entreprise'}
              </Button>
            )
          }
        />
      </div>

      {suspended && (
        <p
          role="status"
          className="rounded-md border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
        >
          Entreprise suspendue : ses utilisateurs ne peuvent plus se connecter.
        </p>
      )}

      <section className="space-y-3" aria-labelledby="details-title">
        <h2 id="details-title" className="text-lg font-semibold tracking-[-0.015em]">
          Coordonnées
        </h2>
        {saved && (
          <p role="status" className="text-[13px] text-success">
            Coordonnées enregistrées.
          </p>
        )}
        <Panel className="p-5 sm:p-6">
          <TenantForm
            key={data.updatedAt}
            tenant={data}
            disabled={!canManage}
            submitLabel="Enregistrer les coordonnées"
            onSubmit={async (values) => {
              setSaved(false);
              // Le schéma de modification a déjà écarté l'identifiant, qui est définitif.
              await update.mutateAsync(values);
              setSaved(true);
            }}
          />
        </Panel>
      </section>

      <UsersPanel tenantId={tenantId} />

      <Dialog
        open={confirmingStatus}
        onOpenChange={setConfirmingStatus}
        title={suspended ? 'Réactiver l’entreprise ?' : 'Suspendre l’entreprise ?'}
        description={
          suspended
            ? `Les utilisateurs de ${data.name} pourront de nouveau se connecter.`
            : `Les ${data.userCount} utilisateurs de ${data.name} seront déconnectés immédiatement et ne pourront plus se connecter. Leurs données sont conservées.`
        }
      >
        <FormError message={update.isError ? update.error.message : null} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmingStatus(false)}>
            Annuler
          </Button>
          <Button
            variant={suspended ? 'primary' : 'danger'}
            disabled={update.isPending}
            onClick={async () => {
              await update.mutateAsync({ status: suspended ? 'ACTIVE' : 'SUSPENDED' });
              setConfirmingStatus(false);
            }}
          >
            {suspended ? 'Réactiver' : 'Suspendre'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
