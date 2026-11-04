'use client';

import type { Page, Tenant, TenantStatus } from '@arksen/shared-types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormError } from '@/components/ui/field';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { SearchInput } from '@/components/ui/search-input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch, queryString } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { TenantForm } from './tenant-form';

const PAGE_SIZE = 25;

export function TenantsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TenantStatus | ''>('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const tenants = useQuery({
    queryKey: ['tenants', { search, status, page }],
    queryFn: () =>
      apiFetch<Page<Tenant>>(
        `/tenants${queryString({ search, status, page, pageSize: PAGE_SIZE })}`,
      ),
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: (values: unknown) =>
      apiFetch<Tenant>('/tenants', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: async (tenant) => {
      await queryClient.invalidateQueries({ queryKey: ['tenants'] });
      setCreating(false);
      router.push(`/tenants/${tenant.id}`);
    },
  });

  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const filtered = Boolean(search || status);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Entreprises clientes"
        description="Chaque entreprise dispose d’un espace isolé : ses utilisateurs ne voient jamais les données d’une autre."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            Nouvelle entreprise
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          label="Rechercher une entreprise"
          placeholder="Nom, identifiant, ville…"
          onSearch={onSearch}
        />
        <div className="w-40">
          <Select
            aria-label="Filtrer par statut"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as TenantStatus | '');
              setPage(1);
            }}
          >
            <option value="">Tous les statuts</option>
            <option value="ACTIVE">Actives</option>
            <option value="SUSPENDED">Suspendues</option>
          </Select>
        </div>
      </div>

      <Panel>
        {tenants.isPending && (
          <div className="space-y-4 p-5" role="status" aria-label="Chargement des entreprises">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-6" />
            ))}
          </div>
        )}
        {tenants.isError && <FormError message={tenants.error.message} />}
        {tenants.data && tenants.data.total === 0 && (
          <div className="flex flex-col items-start gap-3 p-6 sm:p-8">
            <Building2
              className="size-10 rounded-full bg-primary-soft p-2.5 text-primary-soft-foreground"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium">
                {filtered ? 'Aucune entreprise ne correspond' : 'Aucune entreprise cliente'}
              </p>
              <p className="mt-1 text-muted-foreground">
                {filtered
                  ? 'Modifiez la recherche ou le filtre de statut.'
                  : 'Créez la première entreprise, puis son administrateur.'}
              </p>
            </div>
          </div>
        )}
        {tenants.data && tenants.data.total > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entreprise</TableHead>
                  <TableHead className="hidden md:table-cell">Ville</TableHead>
                  <TableHead className="text-right">Utilisateurs</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="hidden sm:table-cell">Créée le</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.data.items.map((tenant) => (
                  <TableRow key={tenant.id}>
                    <TableCell>
                      <Link href={`/tenants/${tenant.id}`} className="font-medium hover:underline">
                        {tenant.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{tenant.slug}</p>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {tenant.city ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">{tenant.userCount}</TableCell>
                    <TableCell>
                      <StatusBadge status={tenant.status} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {formatDate(tenant.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={tenants.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Panel>

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Nouvelle entreprise cliente"
        description="Vous pourrez ensuite créer son administrateur."
        className="max-w-2xl"
      >
        <TenantForm
          submitLabel="Créer l’entreprise"
          onSubmit={(values) => create.mutateAsync(values).then(() => undefined)}
        />
      </Dialog>
    </div>
  );
}
