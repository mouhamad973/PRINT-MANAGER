'use client';

import { METER_SOURCE_LABELS, type ColorMode, type MeterReading } from '@arksen/shared-types';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gauge, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormError } from '@/components/ui/field';
import { Pagination } from '@/components/ui/pagination';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fleetApi, fleetKeys, send } from '@/features/fleet/api';
import { useSession } from '@/features/session/session-provider';
import { formatDateTime } from '@/lib/format';
import { AnomalyBadge, ChartLegend, CoverageNote, VolumeChart, numberFormat } from './meters-ui';
import { periodRange } from './periods';
import { ReadingDialog } from './reading-dialog';

const PAGE_SIZE = 20;

function Counter({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-[-0.03em] tabular-nums">
        {value === null ? '—' : numberFormat.format(value)}
      </dd>
    </div>
  );
}

/** Compteurs d'une machine : dernier relevé, volumes des 12 derniers mois et historique annoté. */
export function PrinterMeters({
  tenantId,
  printerId,
  colorMode,
}: {
  tenantId: string;
  printerId: string;
  colorMode: ColorMode;
}) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const canManage = can('meters:manage');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<MeterReading | null>(null);
  const base = `/tenants/${tenantId}/printers/${printerId}/meter-readings`;
  const range = periodRange('12m');

  const readings = useQuery({
    queryKey: fleetKeys.readings(tenantId, printerId, { page }),
    queryFn: () => fleetApi.readings(tenantId, printerId, { page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const volumes = useQuery({
    queryKey: fleetKeys.readings(tenantId, printerId, { volumes: range }),
    queryFn: () => fleetApi.printerVolumes(tenantId, printerId, { ...range, granularity: 'month' }),
  });
  const anomalies = useQuery({
    queryKey: fleetKeys.anomalies(tenantId, { printerId }),
    queryFn: () => fleetApi.anomalies(tenantId, { printerId }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: fleetKeys.all(tenantId) });
  const last = page === 1 ? (readings.data?.items[0] ?? null) : null;
  const latest = readings.data?.items[0] ?? null;
  const color = colorMode === 'COLOR';

  return (
    <Panel aria-labelledby="meters-title">
      <PanelHeader
        title={<span id="meters-title">Compteurs</span>}
        description={
          latest
            ? `Dernier relevé le ${formatDateTime(latest.readAt)} (${METER_SOURCE_LABELS[latest.source].toLowerCase()})`
            : 'Aucun relevé enregistré'
        }
        actions={
          canManage && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              Nouveau relevé
            </Button>
          )
        }
      />

      {readings.isPending && <Skeleton className="mx-5 mb-5 h-40" />}
      {readings.isError && (
        <div className="px-5 pb-5">
          <FormError message={readings.error.message} />
        </div>
      )}

      {readings.data?.total === 0 && (
        <EmptyState
          icon={Gauge}
          title="Aucun relevé"
          description="Saisissez les compteurs de la machine, ou importez-les depuis la page Compteurs. L’agent de collecte les relèvera automatiquement à partir de la phase 7."
          actions={
            canManage && (
              <Button onClick={() => setAdding(true)}>
                <Plus aria-hidden="true" />
                Saisir un relevé
              </Button>
            )
          }
        />
      )}

      {readings.data && readings.data.total > 0 && (
        <>
          <div className="grid gap-6 px-5 pb-6 lg:grid-cols-[minmax(0,18rem)_1fr]">
            <div className="space-y-5">
              <dl className="grid grid-cols-2 gap-5 lg:grid-cols-1">
                <Counter label="Compteur noir et blanc" value={latest?.blackCount ?? null} />
                {color && <Counter label="Compteur couleur" value={latest?.colorCount ?? null} />}
                <Counter label="Total" value={latest?.totalCount ?? null} />
              </dl>
              {anomalies.data && anomalies.data.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">À vérifier</p>
                  <ul className="space-y-2">
                    {anomalies.data.map((anomaly) => (
                      <li key={`${anomaly.code}-${anomaly.detectedAt}`} className="space-y-1">
                        <AnomalyBadge anomaly={anomaly} />
                        <p className="text-xs text-muted-foreground">{anomaly.message}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">Pages par mois, 12 derniers mois</p>
                <ChartLegend />
              </div>
              {volumes.data ? (
                <>
                  <VolumeChart series={volumes.data.series} height={220} />
                  <CoverageNote coverage={volumes.data.totals.coverage} />
                </>
              ) : (
                <Skeleton className="h-56" />
              )}
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Relevé</TableHead>
                <TableHead className="text-right">Noir et blanc</TableHead>
                {color && <TableHead className="text-right">Couleur</TableHead>}
                <TableHead className="text-right">Pages depuis le précédent</TableHead>
                <TableHead className="hidden md:table-cell">Contrôle</TableHead>
                {canManage && (
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {readings.data.items.map((reading) => (
                <TableRow key={reading.id}>
                  <TableCell>
                    <p className="font-medium whitespace-nowrap">
                      {formatDateTime(reading.readAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {METER_SOURCE_LABELS[reading.source]}
                      {reading.createdByEmail && ` · ${reading.createdByEmail}`}
                    </p>
                  </TableCell>
                  <TableCell className="text-right">
                    {numberFormat.format(reading.blackCount)}
                  </TableCell>
                  {color && (
                    <TableCell className="text-right">
                      {reading.colorCount === null ? '—' : numberFormat.format(reading.colorCount)}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    {reading.isReset ? (
                      <Badge>Remise à zéro</Badge>
                    ) : reading.delta ? (
                      <span className="font-medium">
                        +{numberFormat.format(reading.delta.total)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-wrap gap-1.5">
                      {reading.anomalies.map((anomaly) => (
                        <AnomalyBadge key={anomaly.code} anomaly={anomaly} />
                      ))}
                    </div>
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Supprimer le relevé du ${formatDateTime(reading.readAt)}`}
                        title="Supprimer ce relevé"
                        onClick={() => setDeleting(reading)}
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
            total={readings.data.total}
            onPageChange={setPage}
          />
        </>
      )}

      <ReadingDialog
        open={adding}
        onOpenChange={setAdding}
        colorMode={colorMode}
        last={last}
        onSubmit={async (values) => {
          await send<MeterReading>('POST', base, values);
          setPage(1);
          await refresh();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Supprimer ce relevé ?"
        description="Les volumes et les anomalies seront recalculés sans lui. La suppression est tracée dans le journal d’audit."
        confirmLabel="Supprimer le relevé"
        onConfirm={async () => {
          await send<void>('DELETE', `${base}/${deleting!.id}`);
          await refresh();
        }}
      />
    </Panel>
  );
}
