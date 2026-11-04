'use client';

import type { Site } from '@arksen/shared-types';
import type { SiteCreateInput } from '@arksen/validation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormError } from '@/components/ui/field';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSession } from '@/features/session/session-provider';
import { fleetApi, fleetKeys, send } from './api';
import { ChooseTenant } from './choose-tenant';
import { SiteDialog } from './site-dialog';
import { TenantPicker, useTenantScope } from './tenant-scope';

const PAGE_SIZE = 25;

function SitesList({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const { href } = useTenantScope();
  const queryClient = useQueryClient();
  const canManage = can('sites:manage');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Site | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Site | null>(null);
  const base = `/tenants/${tenantId}/sites`;

  const sites = useQuery({
    queryKey: fleetKeys.sites(tenantId, { search, page }),
    queryFn: () => fleetApi.sites(tenantId, { search, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: fleetKeys.all(tenantId) });
  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  async function save(values: SiteCreateInput) {
    if (editing && editing !== 'new') {
      await send<Site>('PATCH', `${base}/${editing.id}`, values);
    } else {
      await send<Site>('POST', base, values);
    }
    await refresh();
    setEditing(null);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          label="Rechercher un site"
          placeholder="Nom, code ou ville"
          onSearch={onSearch}
        />
        {canManage && (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            Nouveau site
          </Button>
        )}
      </div>

      <Panel>
        {sites.isPending && (
          <div className="space-y-4 p-5" role="status" aria-label="Chargement des sites">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-6" />
            ))}
          </div>
        )}
        {sites.isError && (
          <div className="p-5">
            <FormError message={sites.error.message} />
          </div>
        )}
        {sites.data?.total === 0 && (
          <EmptyState
            icon={MapPin}
            title={search ? 'Aucun site ne correspond' : 'Aucun site'}
            description={
              search
                ? 'Modifiez la recherche.'
                : 'Créez le premier site de l’entreprise : chaque machine du parc y sera rattachée.'
            }
            actions={
              !search &&
              canManage && (
                <Button onClick={() => setEditing('new')}>
                  <Plus aria-hidden="true" />
                  Créer un site
                </Button>
              )
            }
          />
        )}
        {sites.data && sites.data.total > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Site</TableHead>
                  <TableHead className="hidden md:table-cell">Ville</TableHead>
                  <TableHead className="hidden lg:table-cell">Contact</TableHead>
                  <TableHead className="text-right">Machines</TableHead>
                  {canManage && (
                    <TableHead className="text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.data.items.map((site) => (
                  <TableRow key={site.id}>
                    <TableCell>
                      <p className="font-medium">{site.name}</p>
                      {site.code && <p className="text-xs text-muted-foreground">{site.code}</p>}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {[site.postalCode, site.city].filter(Boolean).join(' ') || '—'}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {site.contactName ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {site.printerCount > 0 ? (
                        <Link
                          href={href(`/machines?site=${site.id}`)}
                          className="font-medium text-primary hover:underline"
                        >
                          {site.printerCount}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Modifier ${site.name}`}
                          title="Modifier"
                          onClick={() => setEditing(site)}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Supprimer ${site.name}`}
                          title={
                            site.printerCount > 0
                              ? 'Rattachez ses machines à un autre site avant de le supprimer'
                              : 'Supprimer'
                          }
                          disabled={site.printerCount > 0}
                          onClick={() => setDeleting(site)}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={sites.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Panel>

      <SiteDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        site={editing === 'new' ? null : editing}
        onSubmit={save}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Supprimer ${deleting?.name ?? 'le site'} ?`}
        description="Le site sera définitivement supprimé. Cette action est tracée dans le journal d’audit."
        confirmLabel="Supprimer le site"
        onConfirm={async () => {
          await send<void>('DELETE', `${base}/${deleting!.id}`);
          await refresh();
        }}
      />
    </>
  );
}

export function SitesPage() {
  const { tenantId, tenantName } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sites"
        description={
          tenantName
            ? `Implantations de ${tenantName}, et nombre de machines rattachées à chacune.`
            : 'Implantations de l’entreprise.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? <SitesList key={tenantId} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
