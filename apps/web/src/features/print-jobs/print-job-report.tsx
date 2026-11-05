'use client';

import { ORIENTATION_LABELS, type PrintJob } from '@arksen/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Printer as PrinterIcon, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Panel, PanelHeader } from '@/components/ui/panel';
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
import {
  CalibrationBadge,
  InkLabel,
  formatGrams,
  formatMoney,
} from '@/features/consumption/consumption-ui';
import { fleetApi, fleetKeys, send } from '@/features/fleet/api';
import { ChooseTenant } from '@/features/fleet/choose-tenant';
import { TenantPicker, useTenantScope } from '@/features/fleet/tenant-scope';
import { numberFormat } from '@/features/meters/meters-ui';
import { useSession } from '@/features/session/session-provider';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { RecordPrinted } from '@/features/operations/impressions-page';
import { CoverageBars, formatCoverage } from './coverage-bars';
import { formatSize } from './print-jobs-page';

const mm = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** Choix de la machine, des exemplaires et de la calibration, et l'estimation qui en découle. */
function useJobEstimate(tenantId: string, job: PrintJob) {
  const [printerId, setPrinterId] = useState(job.printer?.id ?? '');
  const [copies, setCopies] = useState(String(job.copies));
  const [useCalibration, setUseCalibration] = useState(true);
  const copiesValue = Number.parseInt(copies, 10);
  const validCopies = Number.isInteger(copiesValue) && copiesValue >= 1;
  const params = {
    printerId,
    copies: validCopies ? copiesValue : job.copies,
    useCalibration: String(useCalibration),
  };
  const estimate = useQuery({
    queryKey: [...fleetKeys.job(tenantId, job.id), 'estimate', params],
    queryFn: () => fleetApi.jobEstimate(tenantId, job.id, params),
    enabled: Boolean(printerId) && validCopies,
    retry: false,
  });
  return {
    printerId,
    setPrinterId,
    copies,
    setCopies,
    copiesValue,
    validCopies,
    useCalibration,
    setUseCalibration,
    estimate,
  };
}

type JobEstimateState = ReturnType<typeof useJobEstimate>;

function Estimate({
  tenantId,
  job,
  state,
}: {
  tenantId: string;
  job: PrintJob;
  state: JobEstimateState;
}) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const {
    printerId,
    setPrinterId,
    copies,
    setCopies,
    copiesValue,
    validCopies,
    useCalibration,
    setUseCalibration,
    estimate,
  } = state;
  const printers = useQuery({
    queryKey: fleetKeys.printers(tenantId, { all: true }),
    queryFn: () => fleetApi.printers(tenantId, { pageSize: 100 }),
  });

  /** La machine et les exemplaires choisis deviennent ceux du travail. */
  async function remember(values: { printerId?: string; copies?: number }) {
    if (!can('print-jobs:manage')) return;
    await send('PATCH', `/tenants/${tenantId}/print-jobs/${job.id}`, values).catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: fleetKeys.jobs(tenantId) });
  }

  const data = estimate.data;

  return (
    <Panel>
      <PanelHeader
        title="Estimation du toner"
        description="Sur la machine choisie, avec ses toners, ses prix et sa calibration"
      />
      <div className="grid gap-4 px-5 pb-5 sm:grid-cols-[minmax(0,1fr)_9rem] print:hidden">
        <Field id="estimate-printer" label="Machine">
          <Select
            id="estimate-printer"
            value={printerId}
            onChange={(event) => {
              setPrinterId(event.target.value);
              if (event.target.value) void remember({ printerId: event.target.value });
            }}
          >
            <option value="">Choisir une machine…</option>
            {printers.data?.items.map((printer) => (
              <option key={printer.id} value={printer.id}>
                {printer.name} · {printer.site.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="estimate-copies" label="Exemplaires">
          <Input
            id="estimate-copies"
            inputMode="numeric"
            value={copies}
            onChange={(event) => setCopies(event.target.value)}
            onBlur={() =>
              validCopies && copiesValue !== job.copies && void remember({ copies: copiesValue })
            }
            aria-invalid={!validCopies}
          />
        </Field>
        <label className="flex cursor-pointer items-center gap-3 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={useCalibration}
            onChange={(event) => setUseCalibration(event.target.checked)}
          />
          Appliquer la calibration de la machine
        </label>
      </div>

      {!printerId && (
        <p className="px-5 pb-6 text-[13px] text-muted-foreground">
          Choisissez la machine qui imprimera ce travail pour estimer son toner et son coût.
        </p>
      )}
      {estimate.isFetching && !data && <Skeleton className="mx-5 mb-6 h-40" />}
      {estimate.isError && (
        <div className="px-5 pb-6">
          <FormError message={errorMessage(estimate.error, 'Estimation impossible.')} />
        </div>
      )}
      {data && printerId && (
        <>
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-3">
            <div className="hero-surface rounded-xl p-4">
              <p className="text-[13px] font-medium">Coût toner du travail</p>
              <p className="mt-3 text-[1.75rem] leading-none font-semibold tracking-[-0.03em] tabular-nums">
                {formatMoney(data.totals.costEstimated, data.currency)}
              </p>
              <p className="mt-2 text-xs text-hero-muted">
                {formatMoney(data.costPerCopy, data.currency)} par exemplaire
              </p>
            </div>
            <div className="rounded-xl border border-border/80 p-4">
              <p className="text-[13px] font-medium">Toner estimé</p>
              <p className="mt-3 text-[1.75rem] leading-none font-semibold tracking-[-0.03em] tabular-nums">
                {formatGrams(data.totals.estimatedGrams)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {formatGrams(data.totals.theoreticalGrams)} en théorique
              </p>
            </div>
            <div className="rounded-xl border border-border/80 p-4">
              <p className="text-[13px] font-medium">Surface imprimée</p>
              <p className="mt-3 text-[1.75rem] leading-none font-semibold tracking-[-0.03em] tabular-nums">
                {numberFormat.format(data.a4EquivalentPages)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                pages A4 équivalentes, {numberFormat.format(data.copies)} exemplaire
                {data.copies > 1 ? 's' : ''}
              </p>
            </div>
          </div>
          {data.grayscale && (
            <p className="mx-5 mb-4 rounded-md border border-border bg-surface-raised px-3.5 py-2.5 text-[13px] text-muted-foreground">
              Machine noir et blanc : les pages couleur s’impriment en niveaux de gris. Le noir suit
              la luminosité de chaque page.
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Encre</TableHead>
                <TableHead className="text-right">Théorique</TableHead>
                <TableHead className="hidden sm:table-cell">Calibration</TableHead>
                <TableHead className="text-right">Estimé</TableHead>
                <TableHead className="text-right">Coût</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.channels.map((channel) => (
                <TableRow key={channel.channel}>
                  <TableCell>
                    <InkLabel channel={channel.channel} className="font-medium" />
                  </TableCell>
                  <TableCell className="text-right">
                    {formatGrams(channel.theoreticalGrams)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <CalibrationBadge calibration={channel.calibration} />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatGrams(channel.estimatedGrams)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoney(channel.costEstimated, data.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {can('print-jobs:manage') && (
            <div className="pt-5">
              <RecordPrinted
                tenantId={tenantId}
                jobId={job.id}
                printerId={printerId}
                copies={data.copies}
              />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function Report({ tenantId, jobId }: { tenantId: string; jobId: string }) {
  const job = useQuery({
    queryKey: fleetKeys.job(tenantId, jobId),
    queryFn: () => fleetApi.job(tenantId, jobId),
  });

  if (job.isPending) {
    return (
      <div className="space-y-4" role="status" aria-label="Chargement du rapport">
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (job.isError) return <FormError message={errorMessage(job.error, 'Analyse introuvable.')} />;
  return <ReportBody tenantId={tenantId} data={job.data} />;
}

function ReportBody({ tenantId, data }: { tenantId: string; data: PrintJob }) {
  const { can } = useSession();
  const { href } = useTenantScope();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const estimateState = useJobEstimate(tenantId, data);
  const jobId = data.id;
  const estimated = estimateState.printerId ? estimateState.estimate.data : undefined;
  const perPage = new Map(estimated?.pages.map((page) => [page.number, page.totalGrams]) ?? []);

  return (
    <div className="space-y-6">
      <Link
        href={href('/analyses')}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Analyse PDF
      </Link>
      <PageHeader
        title={<span className="[overflow-wrap:anywhere]">{data.name}</span>}
        description={`Rapport de préproduction · ${numberFormat.format(data.pageCount)} page${data.pageCount > 1 ? 's' : ''}, dont ${data.colorPages} en couleur · analysé le ${formatDateTime(data.createdAt)}`}
        actions={
          <div className="flex gap-2.5 print:hidden">
            <Button variant="secondary" onClick={() => window.print()}>
              <PrinterIcon aria-hidden="true" />
              Imprimer le rapport
            </Button>
            {can('print-jobs:manage') && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Supprimer l’analyse"
                onClick={() => setDeleting(true)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader title="Document" />
          <dl className="space-y-5 px-5 pb-6 text-[13px]">
            <div>
              <dt className="text-xs text-muted-foreground">
                Couverture moyenne, pondérée par la surface
              </dt>
              <dd className="mt-2.5">
                <CoverageBars coverage={data.averageCoverage} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Formats</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {data.formats.map((entry) => (
                  <Badge key={entry.format}>
                    {entry.format} × {entry.pages}
                  </Badge>
                ))}
              </dd>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-xs text-muted-foreground">Fichier</dt>
                <dd className="mt-1 font-medium">{formatSize(data.fileSize)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Résolution d’analyse</dt>
                <dd className="mt-1 font-medium">{data.dpi} ppp</dd>
              </div>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Empreinte SHA-256</dt>
              <dd className="mt-1 font-mono text-xs break-all text-muted-foreground">
                {data.fileSha256}
              </dd>
            </div>
          </dl>
        </Panel>
        {can('consumption:read') ? (
          <Estimate tenantId={tenantId} job={data} state={estimateState} />
        ) : (
          <Panel className="p-5 text-muted-foreground">
            L’estimation du toner est réservée aux rôles qui consultent la consommation.
          </Panel>
        )}
      </div>

      <Panel>
        <PanelHeader
          title="Pages"
          description="Couverture de chaque encre : moyenne de sa teinte sur la surface de la page"
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Page</TableHead>
              <TableHead>Format</TableHead>
              <TableHead className="hidden md:table-cell">Dimensions</TableHead>
              <TableHead className="w-48">C M J N</TableHead>
              <TableHead className="text-right">Cumulée</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Toner, 1 ex.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.pages.map((page) => {
              const total =
                page.coverage.cyan +
                page.coverage.magenta +
                page.coverage.yellow +
                page.coverage.black;
              return (
                <TableRow key={page.number}>
                  <TableCell className="font-medium tabular-nums">
                    {page.number}
                    {page.isColor ? (
                      <Badge tone="brand" className="ml-2">
                        <StatusDot />
                        Couleur
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {page.format}
                    <p className="text-xs text-muted-foreground">
                      {ORIENTATION_LABELS[page.orientation]}
                    </p>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">
                    {mm.format(page.widthMm)} × {mm.format(page.heightMm)} mm
                  </TableCell>
                  <TableCell>
                    <CoverageBars coverage={page.coverage} compact />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCoverage(total)}</TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    {perPage.has(page.number) ? formatGrams(perPage.get(page.number)!) : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Panel>

      <Panel className="p-5 text-[13px] text-muted-foreground">
        <p className="font-semibold text-foreground">Méthode de mesure</p>
        <p className="mt-2">
          Chaque page est rendue en sRGB sur fond blanc par PDFium, qui applique les profils ICC du
          document, les couleurs spéciales, les transparences et les modes de fusion. Les pixels
          sont ensuite séparés en cyan, magenta, jaune et noir
          {data.method.includes('icc:')
            ? ` avec le profil ICC de sortie ${data.method.split('icc:')[1]}.`
            : ' par la séparation de référence, sans profil : génération du noir à 100 %.'}
        </p>
        <p className="mt-1.5">
          La couverture d’une encre est la moyenne de sa valeur de teinte sur toute la surface de la
          page : une demi-page en aplat plein vaut 50 %, une page entière à 20 % vaut 20 %. Ce n’est
          pas une proportion de pixels colorés. Les écarts propres à chaque machine sont corrigés
          par sa calibration.
        </p>
        <p className="mt-1.5 font-mono text-xs">{data.method}</p>
      </Panel>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Supprimer cette analyse ?"
        description="Les mesures de ses pages seront définitivement supprimées."
        confirmLabel="Supprimer"
        onConfirm={async () => {
          await send<void>('DELETE', `/tenants/${tenantId}/print-jobs/${jobId}`);
          await queryClient.invalidateQueries({ queryKey: fleetKeys.jobs(tenantId) });
          router.push(href('/analyses'));
        }}
      />
    </div>
  );
}

export function PrintJobReport({ jobId }: { jobId: string }) {
  const { tenantId, isPlatform } = useTenantScope();
  if (!tenantId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Rapport de préproduction" actions={isPlatform && <TenantPicker />} />
        <ChooseTenant />
      </div>
    );
  }
  return <Report tenantId={tenantId} jobId={jobId} />;
}
