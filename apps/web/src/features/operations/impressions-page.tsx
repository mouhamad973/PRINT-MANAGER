'use client';

import type { PrintedJob } from '@arksen/shared-types';
import { printJobPrintedSchema } from '@arksen/validation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Printer as PrinterIcon, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChooseTenant } from '@/features/fleet/choose-tenant';
import { TenantPicker, useTenantScope } from '@/features/fleet/tenant-scope';
import { numberFormat } from '@/features/meters/meters-ui';
import { useSession } from '@/features/session/session-provider';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { opsApi, opsKeys } from './api';
import { money } from './ops-ui';

const PAGE_SIZE = 20;

/**
 * Enregistre un travail analysé comme imprimé, sur la machine et le nombre d'exemplaires du
 * rapport : son coût de revient est figé, son prix de vente donne la marge.
 */
export function RecordPrinted({
  tenantId,
  jobId,
  printerId,
  copies,
}: {
  tenantId: string;
  jobId: string;
  printerId: string;
  copies: number;
}) {
  const { href } = useTenantScope();
  const queryClient = useQueryClient();
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PrintedJob | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="mx-5 mb-5 grid gap-3 rounded-xl border border-border/80 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end print:hidden">
      <Field id="printed-price" label="Prix de vente du travail" hint="Facultatif : donne la marge">
        <Input
          id="printed-price"
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </Field>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={async () => {
          const parsed = printJobPrintedSchema.safeParse({ printerId, copies, salePrice: price });
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Saisie invalide.');
            return;
          }
          setPending(true);
          setError(null);
          try {
            setDone(await opsApi.markPrinted(tenantId, jobId, parsed.data));
            await queryClient.invalidateQueries({ queryKey: opsKeys.all(tenantId) });
          } catch (caught) {
            setError(errorMessage(caught));
          } finally {
            setPending(false);
          }
        }}
      >
        <PrinterIcon aria-hidden="true" />
        Enregistrer l’impression
      </Button>
      <div className="sm:col-span-2">
        <FormError message={error} />
        {done && (
          <p className="text-[13px] text-muted-foreground">
            Enregistrée : coût de revient {money(done.cost, done.currency)}
            {done.margin !== null && `, marge ${money(done.margin, done.currency)}`}.{' '}
            <Link className="text-primary hover:underline" href={href('/impressions')}>
              Voir le registre
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

function ImpressionsView({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const { href } = useTenantScope();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [removing, setRemoving] = useState<PrintedJob | null>(null);
  const printed = useQuery({
    queryKey: opsKeys.key(tenantId, 'printed', { search, page }),
    queryFn: () => opsApi.printed(tenantId, { search, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const all = useQuery({
    queryKey: opsKeys.key(tenantId, 'printed', { all: true }),
    queryFn: () => opsApi.printed(tenantId, { pageSize: 100 }),
  });
  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);
  const items = all.data?.items ?? [];
  const currency = items[0]?.currency ?? 'XOF';
  const cost = items.reduce((sum, item) => sum + (item.cost ?? 0), 0);
  const sales = items.filter((item) => item.salePrice !== null);
  const revenue = sales.reduce((sum, item) => sum + (item.salePrice ?? 0), 0);
  const margin = sales.reduce((sum, item) => sum + (item.margin ?? 0), 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          featured
          label="Travaux imprimés"
          value={numberFormat.format(all.data?.total ?? 0)}
          hint="Sur les 100 derniers"
        />
        <StatCard
          compact
          label="Coût de revient"
          value={money(cost, currency, 0)}
          hint="Toner et papier"
        />
        <StatCard
          compact
          label="Chiffre d’affaires"
          value={money(revenue, currency, 0)}
          hint={`${sales.length} travail(aux) facturé(s)`}
        />
        <StatCard
          compact
          label="Marge"
          value={money(margin, currency, 0)}
          hint="Sur les travaux facturés"
        />
      </div>
      <Panel>
        <PanelHeader
          title="Registre des impressions"
          description="Travaux analysés puis imprimés : coût de revient figé à l’enregistrement, prix de vente et marge"
          actions={
            <SearchInput
              label="Rechercher un travail"
              placeholder="Nom du fichier"
              onSearch={onSearch}
            />
          }
        />
        {printed.isPending && <Skeleton className="mx-5 mb-5 h-32" />}
        {printed.data?.total === 0 && (
          <EmptyState
            icon={ClipboardList}
            title="Aucune impression enregistrée"
            description="Depuis le rapport de préproduction d’un fichier analysé, enregistrez son impression : son coût de revient et sa marge s’ajoutent ici."
          />
        )}
        {printed.data && printed.data.total > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Travail</TableHead>
                  <TableHead className="hidden md:table-cell">Machine</TableHead>
                  <TableHead className="text-right">Exemplaires</TableHead>
                  <TableHead className="text-right">Coût</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Prix</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Marge</TableHead>
                  {can('print-jobs:manage') && <TableHead className="w-0" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {printed.data.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-72">
                      <Link
                        className="block truncate font-medium hover:underline"
                        href={href(`/analyses/${item.id}`)}
                      >
                        {item.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(item.printedAt)} · {item.pageCount} page(s)
                      </p>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {item.printer?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {numberFormat.format(item.copies)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(item.cost, item.currency)}
                      <p className="text-xs text-muted-foreground">
                        toner {money(item.tonerCost, item.currency)}, papier{' '}
                        {money(item.paperCost, item.currency)}
                      </p>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {money(item.salePrice, item.currency)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'hidden text-right font-medium tabular-nums sm:table-cell',
                        (item.margin ?? 0) < 0 && 'text-danger',
                      )}
                    >
                      {money(item.margin, item.currency)}
                    </TableCell>
                    {can('print-jobs:manage') && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Retirer du registre"
                          onClick={() => setRemoving(item)}
                        >
                          <Undo2 aria-hidden="true" />
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
              total={printed.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Panel>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Retirer ce travail du registre ?"
        description="Son analyse est conservée ; seul l’enregistrement de l’impression disparaît."
        confirmLabel="Retirer"
        onConfirm={async () => {
          if (!removing) return;
          await opsApi.unmarkPrinted(tenantId, removing.id);
          setRemoving(null);
          await queryClient.invalidateQueries({ queryKey: opsKeys.all(tenantId) });
        }}
      />
    </>
  );
}

export function ImpressionsPage() {
  const { tenantId, tenantName } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Impressions"
        description={
          tenantName
            ? `Travaux imprimés par ${tenantName}, leur coût et leur marge.`
            : 'Travaux imprimés, leur coût et leur marge.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? <ImpressionsView key={tenantId} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
