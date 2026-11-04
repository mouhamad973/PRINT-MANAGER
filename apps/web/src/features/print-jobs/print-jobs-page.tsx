'use client';

import type { PrintJob } from '@arksen/shared-types';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSearch, FileUp } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, type DragEvent } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Panel, PanelHeader } from '@/components/ui/panel';
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
import { fleetApi, fleetKeys } from '@/features/fleet/api';
import { ChooseTenant } from '@/features/fleet/choose-tenant';
import { TenantPicker, useTenantScope } from '@/features/fleet/tenant-scope';
import { numberFormat } from '@/features/meters/meters-ui';
import { useSession } from '@/features/session/session-provider';
import { apiUpload, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CoverageBars } from './coverage-bars';

const PAGE_SIZE = 20;
const MAX_BYTES = 50 * 1024 * 1024;
const sizeFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${sizeFormat.format(bytes / 1024)} Ko`
    : `${sizeFormat.format(bytes / 1024 / 1024)} Mo`;
}

/** Envoi d'un PDF : le fichier est analysé par le serveur, puis oublié ; seules ses mesures restent. */
function UploadPanel({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const { href } = useTenantScope();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [printerId, setPrinterId] = useState('');
  const [copies, setCopies] = useState('1');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const printers = useQuery({
    queryKey: fleetKeys.printers(tenantId, { all: true }),
    queryFn: () => fleetApi.printers(tenantId, { pageSize: 100 }),
  });

  function choose(candidate: File | undefined) {
    setError(null);
    if (!candidate) return;
    if (candidate.size > MAX_BYTES) {
      setError('Le fichier dépasse 50 Mo.');
      return;
    }
    setFile(candidate);
  }

  async function analyze() {
    if (!file) return;
    setPending(true);
    setError(null);
    const form = new FormData();
    form.append('file', file, file.name);
    if (printerId) form.append('printerId', printerId);
    form.append('copies', copies || '1');
    try {
      const job = await apiUpload<PrintJob>(`/tenants/${tenantId}/print-jobs`, form);
      await queryClient.invalidateQueries({ queryKey: fleetKeys.jobs(tenantId) });
      router.push(href(`/analyses/${job.id}`));
    } catch (caught) {
      setError(errorMessage(caught, 'Analyse impossible.'));
      setPending(false);
    }
  }

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0]);
  };

  return (
    <Panel>
      <PanelHeader
        title="Analyser un fichier"
        description="Formats, dimensions et couverture CMJN de chaque page, puis estimation du toner."
      />
      <div className="grid gap-5 px-5 pb-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input px-4 py-6 text-center transition-colors hover:border-primary hover:bg-primary-soft/40',
            dragging && 'border-primary bg-primary-soft/60',
          )}
        >
          <FileUp className="size-7 text-primary" aria-hidden="true" />
          <span className="font-semibold">
            {file ? file.name : 'Déposez un PDF ici, ou choisissez-le'}
          </span>
          <span className="text-[13px] text-muted-foreground">
            {file ? formatSize(file.size) : '50 Mo et 500 pages au maximum'}
          </span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(event) => choose(event.target.files?.[0])}
          />
        </label>
        <div className="grid content-start gap-4">
          <Field
            id="job-printer"
            label="Machine prévue"
            hint="Facultatif : elle se choisit aussi dans le rapport"
          >
            <Select
              id="job-printer"
              value={printerId}
              onChange={(event) => setPrinterId(event.target.value)}
            >
              <option value="">Aucune pour l’instant</option>
              {printers.data?.items.map((printer) => (
                <option key={printer.id} value={printer.id}>
                  {printer.name} · {printer.site.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="job-copies" label="Exemplaires">
            <Input
              id="job-copies"
              inputMode="numeric"
              value={copies}
              onChange={(event) => setCopies(event.target.value)}
            />
          </Field>
          <FormError message={error} />
          <Button disabled={!file || pending} onClick={analyze}>
            <FileSearch aria-hidden="true" />
            {pending ? 'Analyse en cours…' : 'Analyser le fichier'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Le fichier n’est pas conservé : seules ses mesures le sont.
          </p>
        </div>
      </div>
    </Panel>
  );
}

function JobsList({ tenantId }: { tenantId: string }) {
  const { href } = useTenantScope();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const jobs = useQuery({
    queryKey: fleetKeys.jobs(tenantId, { search, page }),
    queryFn: () => fleetApi.jobs(tenantId, { search, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  return (
    <Panel>
      <PanelHeader
        title="Fichiers analysés"
        actions={
          <SearchInput
            label="Rechercher un fichier"
            placeholder="Nom du fichier"
            onSearch={onSearch}
          />
        }
      />
      {jobs.isPending && <Skeleton className="mx-5 mb-5 h-32" />}
      {jobs.isError && (
        <div className="px-5 pb-5">
          <FormError message={jobs.error.message} />
        </div>
      )}
      {jobs.data?.total === 0 && (
        <EmptyState
          icon={FileSearch}
          title={search ? 'Aucun fichier ne correspond' : 'Aucun fichier analysé'}
          description={
            search
              ? 'Modifiez la recherche.'
              : 'Analysez un PDF avant de l’imprimer : vous saurez quel toner il consommera, page par page.'
          }
        />
      )}
      {jobs.data && jobs.data.total > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fichier</TableHead>
                <TableHead className="text-right">Pages</TableHead>
                <TableHead className="hidden md:table-cell">Couverture moyenne C M J N</TableHead>
                <TableHead className="hidden lg:table-cell">Machine prévue</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Exemplaires</TableHead>
                <TableHead className="hidden xl:table-cell">Analysé le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.data.items.map((job) => (
                <TableRow key={job.id} className="relative">
                  <TableCell className="max-w-72">
                    <Link
                      href={href(`/analyses/${job.id}`)}
                      className="block truncate font-medium after:absolute after:inset-0 hover:underline"
                      title={job.name}
                    >
                      {job.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{formatSize(job.fileSize)}</p>
                  </TableCell>
                  <TableCell className="text-right">
                    {numberFormat.format(job.pageCount)}
                    <p className="text-xs text-muted-foreground">{job.colorPages} couleur</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <CoverageBars coverage={job.averageCoverage} compact />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {job.printer?.name ?? '—'}
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    {numberFormat.format(job.copies)}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground xl:table-cell">
                    {formatDateTime(job.createdAt)}
                    {job.createdByEmail && <p className="text-xs">{job.createdByEmail}</p>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={jobs.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </Panel>
  );
}

export function PrintJobsPage() {
  const { tenantId, tenantName } = useTenantScope();
  const { can } = useSession();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Analyse PDF"
        description={
          tenantName
            ? `Rapports de préproduction de ${tenantName} : chaque page mesurée, et le toner du travail estimé avant impression.`
            : 'Rapports de préproduction : chaque page mesurée, et le toner du travail estimé avant impression.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? (
        <>
          {can('print-jobs:manage') && <UploadPanel tenantId={tenantId} />}
          <JobsList key={tenantId} tenantId={tenantId} />
        </>
      ) : (
        <ChooseTenant />
      )}
    </div>
  );
}
