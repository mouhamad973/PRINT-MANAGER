'use client';

import {
  COLOR_MODE_LABELS,
  COLOR_MODES,
  PRINTER_STATUS_LABELS,
  PRINTER_STATUSES,
  type PrinterDetail,
} from '@arksen/shared-types';
import type { PrinterCreateInput } from '@arksen/validation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Printer as PrinterIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FormError } from '@/components/ui/field';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { SearchInput } from '@/components/ui/search-input';
import { Select } from '@/components/ui/select';
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
import { ColorModeTag, ConnectivityBadge, PrinterStatusBadge } from './fleet-badges';
import { PrinterDialog } from './printer-dialog';
import { TenantPicker, useTenantScope } from './tenant-scope';

const PAGE_SIZE = 25;

function PrintersList({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const { href } = useTenantScope();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const canManage = can('printers:manage');
  // Le site et la recherche peuvent venir d'un lien (liste des sites, recherche de l'en-tête).
  const initialSearch = searchParams.get('search') ?? '';
  const [search, setSearch] = useState(initialSearch);
  const [siteId, setSiteId] = useState(searchParams.get('site') ?? '');
  const [status, setStatus] = useState('');
  const [colorMode, setColorMode] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const filters = { search, siteId, status, colorMode, page };

  const printers = useQuery({
    queryKey: fleetKeys.printers(tenantId, filters),
    queryFn: () => fleetApi.printers(tenantId, { ...filters, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const sites = useQuery({
    queryKey: fleetKeys.sites(tenantId, { all: true }),
    queryFn: () => fleetApi.allSites(tenantId),
  });

  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);
  const filtered = Boolean(search || siteId || status || colorMode);

  async function create(values: PrinterCreateInput) {
    const printer = await send<PrinterDetail>('POST', `/tenants/${tenantId}/printers`, values);
    await queryClient.invalidateQueries({ queryKey: fleetKeys.all(tenantId) });
    setCreating(false);
    router.push(href(`/machines/${printer.id}`));
  }

  const filter = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: [string, string][],
  ) => (
    <div className="min-w-36 flex-1 sm:w-44 sm:flex-none">
      <Select
        aria-label={label}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setPage(1);
        }}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full flex-wrap items-center gap-2.5 xl:w-auto">
          <SearchInput
            label="Rechercher une machine"
            placeholder="Nom, série, adresse IP…"
            defaultValue={initialSearch}
            onSearch={onSearch}
          />
          {filter('Site', siteId, setSiteId, [
            ['', 'Tous les sites'],
            ...(sites.data?.items.map((site): [string, string] => [site.id, site.name]) ?? []),
          ])}
          {filter('Statut', status, setStatus, [
            ['', 'Parc actif'],
            ...PRINTER_STATUSES.map((value): [string, string] => [
              value,
              PRINTER_STATUS_LABELS[value],
            ]),
          ])}
          {filter('Type d’impression', colorMode, setColorMode, [
            ['', 'Couleur et N&B'],
            ...COLOR_MODES.map((value): [string, string] => [value, COLOR_MODE_LABELS[value]]),
          ])}
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            Nouvelle machine
          </Button>
        )}
      </div>

      <Panel>
        {printers.isPending && (
          <div className="space-y-4 p-5" role="status" aria-label="Chargement du parc">
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className="h-6" />
            ))}
          </div>
        )}
        {printers.isError && (
          <div className="p-5">
            <FormError message={printers.error.message} />
          </div>
        )}
        {printers.data?.total === 0 && (
          <EmptyState
            icon={PrinterIcon}
            title={filtered ? 'Aucune machine ne correspond' : 'Le parc est vide'}
            description={
              filtered
                ? 'Modifiez la recherche ou les filtres. Les machines retirées n’apparaissent qu’avec le filtre « Retirée du parc ».'
                : 'Ajoutez la première machine. Il faut au préalable un site et la fiche technique de son modèle.'
            }
            actions={
              !filtered &&
              canManage && (
                <>
                  <Button onClick={() => setCreating(true)}>
                    <Plus aria-hidden="true" />
                    Ajouter une machine
                  </Button>
                  <Button variant="secondary" asChild>
                    <Link href={href('/sites')}>Gérer les sites</Link>
                  </Button>
                </>
              )
            }
          />
        )}
        {printers.data && printers.data.total > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Machine</TableHead>
                  <TableHead className="hidden md:table-cell">Site</TableHead>
                  <TableHead className="hidden lg:table-cell">Modèle</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="hidden xl:table-cell">Adresse</TableHead>
                  <TableHead className="hidden sm:table-cell">Connectivité</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {printers.data.items.map((printer) => (
                  <TableRow key={printer.id} className="relative">
                    <TableCell>
                      <Link
                        href={href(`/machines/${printer.id}`)}
                        className="font-medium after:absolute after:inset-0 hover:underline"
                      >
                        {printer.name}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">
                        {printer.serialNumber}
                      </p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {printer.site.name}
                      {printer.location && (
                        <p className="text-xs text-muted-foreground">{printer.location}</p>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <p
                        className="max-w-56 truncate"
                        title={`${printer.model.manufacturer} ${printer.model.name}`}
                      >
                        {printer.model.name}
                      </p>
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{printer.model.manufacturer}</span>
                        <ColorModeTag colorMode={printer.model.colorMode} />
                      </p>
                    </TableCell>
                    <TableCell>
                      <PrinterStatusBadge status={printer.status} />
                    </TableCell>
                    <TableCell className="hidden font-mono text-[13px] xl:table-cell">
                      {printer.address ?? (
                        <span className="font-sans text-muted-foreground">Non configurée</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <ConnectivityBadge connectivity={printer.connectivity} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={printers.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Panel>

      <PrinterDialog
        open={creating}
        onOpenChange={setCreating}
        tenantId={tenantId}
        printer={null}
        defaultSiteId={siteId}
        onSubmit={create}
      />
    </>
  );
}

export function PrintersPage() {
  const { tenantId, tenantName } = useTenantScope();
  const searchParams = useSearchParams();
  // Une nouvelle recherche depuis l'en-tête repart des paramètres de l'URL.
  const listKey = `${tenantId}:${searchParams.get('search') ?? ''}:${searchParams.get('site') ?? ''}`;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Machines"
        description={
          tenantName
            ? `Parc d’impression de ${tenantName}. La connectivité sera relevée par l’agent de collecte (phase 7).`
            : 'Parc d’impression de l’entreprise.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? <PrintersList key={listKey} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
