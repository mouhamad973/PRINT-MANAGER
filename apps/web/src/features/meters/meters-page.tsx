'use client';

import {
  COLOR_MODE_LABELS,
  COLOR_MODES,
  COMPARISON_LABELS,
  type Comparison,
} from '@arksen/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gauge, Upload } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FormError } from '@/components/ui/field';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
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
import { fleetApi, fleetKeys } from '@/features/fleet/api';
import { ChooseTenant } from '@/features/fleet/choose-tenant';
import { TenantPicker, useTenantScope } from '@/features/fleet/tenant-scope';
import { useSession } from '@/features/session/session-provider';
import { formatDate } from '@/lib/format';
import { ImportDialog } from './import-dialog';
import {
  AnomalyBadge,
  ChartLegend,
  CoverageNote,
  Variation,
  VolumeChart,
  formatPercent,
  numberFormat,
} from './meters-ui';
import { PERIOD_PRESETS, periodRange, rangeLabel, type PeriodPreset } from './periods';

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <div className="min-w-36 flex-1 sm:w-48 sm:flex-none">
      <Select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </Select>
    </div>
  );
}

function Meters({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const { href } = useTenantScope();
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<PeriodPreset>('30d');
  const [compare, setCompare] = useState<Comparison>('previous');
  const [siteId, setSiteId] = useState('');
  const [colorMode, setColorMode] = useState('');
  const [importing, setImporting] = useState(false);
  const range = periodRange(preset);
  const params = { ...range, compare, siteId, colorMode };

  const volumes = useQuery({
    queryKey: fleetKeys.volumes(tenantId, params),
    queryFn: () => fleetApi.volumes(tenantId, params),
  });
  const anomalies = useQuery({
    queryKey: fleetKeys.anomalies(tenantId, { siteId }),
    queryFn: () => fleetApi.anomalies(tenantId, { siteId }),
  });
  const sites = useQuery({
    queryKey: fleetKeys.sites(tenantId, { all: true }),
    queryFn: () => fleetApi.allSites(tenantId),
  });

  const data = volumes.data;
  const totals = data?.totals;
  const previous = data?.previousTotals;
  const comparisonHint = data && `vs ${COMPARISON_LABELS[data.comparison.kind]}`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full flex-wrap items-center gap-2.5 xl:w-auto">
          <Filter
            label="Période"
            value={preset}
            onChange={(value) => setPreset(value as PeriodPreset)}
            options={PERIOD_PRESETS.map((item) => [item.value, item.label])}
          />
          <Filter
            label="Comparer avec"
            value={compare}
            onChange={(value) => setCompare(value as Comparison)}
            options={[
              ['previous', 'vs période précédente'],
              ['year', 'vs l’an dernier'],
            ]}
          />
          <Filter
            label="Site"
            value={siteId}
            onChange={setSiteId}
            options={[
              ['', 'Tous les sites'],
              ...(sites.data?.items.map((site): [string, string] => [site.id, site.name]) ?? []),
            ]}
          />
          <Filter
            label="Type d’impression"
            value={colorMode}
            onChange={setColorMode}
            options={[
              ['', 'Couleur et N&B'],
              ...COLOR_MODES.map((mode): [string, string] => [mode, COLOR_MODE_LABELS[mode]]),
            ]}
          />
        </div>
        {can('meters:manage') && (
          <Button variant="secondary" onClick={() => setImporting(true)}>
            <Upload aria-hidden="true" />
            Importer des relevés
          </Button>
        )}
      </div>

      {volumes.isError && <FormError message={volumes.error.message} />}
      {!data && !volumes.isError && (
        <div
          className="grid grid-cols-2 gap-4 xl:grid-cols-4"
          role="status"
          aria-label="Chargement des volumes"
        >
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-40 rounded-2xl" />
          ))}
        </div>
      )}

      {data && totals && previous && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard
              featured
              className="col-span-2 sm:col-span-1"
              label="Pages imprimées"
              value={numberFormat.format(totals.total)}
              hint={
                <>
                  <Variation current={totals.total} previous={previous.total} />
                  {comparisonHint}
                </>
              }
            />
            <StatCard
              label="Noir et blanc"
              value={numberFormat.format(totals.black)}
              hint={
                <>
                  <Variation current={totals.black} previous={previous.black} />
                  {comparisonHint}
                </>
              }
            />
            <StatCard
              label="Couleur"
              value={numberFormat.format(totals.color)}
              hint={
                <>
                  <Variation current={totals.color} previous={previous.color} />
                  {comparisonHint}
                </>
              }
            />
            <StatCard
              label="Part couleur"
              value={totals.total === 0 ? '—' : formatPercent(totals.color / totals.total)}
              hint={
                previous.total === 0
                  ? 'Pas de référence'
                  : `${formatPercent(previous.color / previous.total)} sur la ${COMPARISON_LABELS[data.comparison.kind]}`
              }
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Panel className="xl:col-span-2">
              <PanelHeader
                title={data.granularity === 'day' ? 'Pages par jour' : 'Pages par mois'}
                description={`${rangeLabel(data.from, data.to)}, comparé ${rangeLabel(data.comparison.from, data.comparison.to)}`}
                actions={<ChartLegend />}
              />
              <div className="space-y-3 px-3 pb-5">
                <VolumeChart series={data.series} />
                <div className="px-2">
                  <CoverageNote coverage={totals.coverage} />
                </div>
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                title="Anomalies de compteurs"
                description="Relevés des 90 derniers jours et machines en service"
              />
              {anomalies.data?.length === 0 && (
                <p className="px-5 pb-6 text-muted-foreground">Aucune anomalie détectée.</p>
              )}
              {anomalies.data && anomalies.data.length > 0 && (
                <ul className="max-h-[22rem] divide-y divide-border/80 overflow-y-auto border-t border-border/80">
                  {anomalies.data.map((anomaly) => (
                    <li
                      key={`${anomaly.printerId}-${anomaly.code}-${anomaly.detectedAt}`}
                      className="relative space-y-1.5 px-5 py-3.5 hover:bg-surface-raised"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          href={href(`/machines/${anomaly.printerId}`)}
                          className="font-medium after:absolute after:inset-0 hover:underline"
                        >
                          {anomaly.printerName}
                        </Link>
                        <AnomalyBadge anomaly={anomaly} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {anomaly.siteName} · {anomaly.message}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel>
            <PanelHeader
              title="Volumes par machine"
              description={`Sur la période, comparés à la ${COMPARISON_LABELS[data.comparison.kind]}`}
            />
            {data.byPrinter.length === 0 ? (
              <EmptyState
                icon={Gauge}
                title="Aucune machine"
                description="Aucune machine ne correspond à ces filtres."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Machine</TableHead>
                    <TableHead className="hidden lg:table-cell">Dernier relevé</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Noir et blanc</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Couleur</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Référence</TableHead>
                    <TableHead className="text-right">Évolution</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byPrinter.map((row) => (
                    <TableRow key={row.printerId} className="relative">
                      <TableCell>
                        <Link
                          href={href(`/machines/${row.printerId}`)}
                          className="font-medium after:absolute after:inset-0 hover:underline"
                        >
                          {row.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{row.siteName}</p>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {row.lastReadingAt ? formatDate(row.lastReadingAt) : 'Aucun'}
                      </TableCell>
                      <TableCell className="hidden text-right md:table-cell">
                        {row.current.coverage === 0 ? '—' : numberFormat.format(row.current.black)}
                      </TableCell>
                      <TableCell className="hidden text-right md:table-cell">
                        {row.colorMode === 'COLOR' && row.current.coverage > 0
                          ? numberFormat.format(row.current.color)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {row.current.coverage === 0 ? (
                          <span
                            className="font-normal text-muted-foreground"
                            title="Aucun relevé sur la période"
                          >
                            Inconnu
                          </span>
                        ) : (
                          numberFormat.format(row.current.total)
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right text-muted-foreground sm:table-cell">
                        {row.previous.coverage === 0
                          ? '—'
                          : numberFormat.format(row.previous.total)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Variation current={row.current.total} previous={row.previous.total} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </>
      )}

      <ImportDialog
        open={importing}
        onOpenChange={setImporting}
        tenantId={tenantId}
        onImported={() => queryClient.invalidateQueries({ queryKey: fleetKeys.all(tenantId) })}
      />
    </>
  );
}

export function MetersPage() {
  const { tenantId, tenantName } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Compteurs"
        description={
          tenantName
            ? `Volumes d’impression de ${tenantName}, calculés à partir des relevés de compteurs.`
            : 'Volumes d’impression, calculés à partir des relevés de compteurs.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? <Meters key={tenantId} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
