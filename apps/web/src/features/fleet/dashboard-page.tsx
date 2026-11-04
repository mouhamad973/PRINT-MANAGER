'use client';

import {
  COLOR_MODE_LABELS,
  COLOR_MODES,
  PRINTER_STATUS_LABELS,
  type FleetDashboard,
} from '@arksen/shared-types';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Network, Plus, Printer as PrinterIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '@/components/layout/page-header';
import { StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FormError } from '@/components/ui/field';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import {
  AnomalyBadge,
  ChartLegend,
  CoverageNote,
  Variation,
  VolumeChart,
  numberFormat,
} from '@/features/meters/meters-ui';
import { periodRange } from '@/features/meters/periods';
import {
  INK_CLASSES,
  InkLabel,
  formatGrams,
  formatMoney,
} from '@/features/consumption/consumption-ui';
import { AlertsOverview } from '@/features/stocks/alerts-overview';
import { useSession } from '@/features/session/session-provider';
import { fleetApi, fleetKeys } from './api';
import { ChooseTenant } from './choose-tenant';
import { PrinterStatusBadge } from './fleet-badges';
import { TenantPicker, useTenantScope } from './tenant-scope';

const percentFormat = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 0,
});

function share(part: number, total: number): string {
  return total === 0 ? '—' : percentFormat.format(part / total);
}

/** Indicateurs du cahier des charges qui arrivent avec les phases suivantes : annoncés, jamais simulés. */
const UPCOMING = [
  { label: 'Coûts d’impression et coût copie', phase: 9 },
  { label: 'Rapports PDF et Excel', phase: 10 },
];

function SitesChart({ data }: { data: FleetDashboard['bySite'] }) {
  const height = Math.max(160, data.length * 44);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={130}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 13 }}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)', radius: 8 }}
            formatter={(value) => [`${value} machine${Number(value) > 1 ? 's' : ''}`, 'Parc']}
            contentStyle={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              borderRadius: 12,
              color: 'var(--foreground)',
              fontSize: 13,
            }}
          />
          <Bar dataKey="count" radius={[8, 8, 8, 8]} barSize={22} isAnimationActive={false}>
            {data.map((site, index) => (
              <Cell key={site.siteId} fill={index === 0 ? 'var(--chart-1)' : 'var(--chart-2)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Barre de proportion : la part d'un total, en vrai. */
function Meter({ value, total, label }: { value: number; total: number; label: string }) {
  const ratio = total === 0 ? 0 : value / total;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">
          {value} / {total}
        </span>
      </div>
      <div
        className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={value}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

function Dashboard({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const { href } = useTenantScope();
  const [siteId, setSiteId] = useState('');
  const [colorMode, setColorMode] = useState('');
  const filters = { siteId, colorMode };
  const dashboard = useQuery({
    queryKey: fleetKeys.dashboard(tenantId, filters),
    queryFn: () => fleetApi.dashboard(tenantId, filters),
  });
  const volumeParams = { ...periodRange('30d'), siteId, colorMode };
  const volumes = useQuery({
    queryKey: fleetKeys.volumes(tenantId, volumeParams),
    queryFn: () => fleetApi.volumes(tenantId, volumeParams),
    enabled: can('meters:read'),
  });
  const anomalies = useQuery({
    queryKey: fleetKeys.anomalies(tenantId, { siteId }),
    queryFn: () => fleetApi.anomalies(tenantId, { siteId }),
    enabled: can('meters:read'),
  });
  const consumption = useQuery({
    queryKey: fleetKeys.consumption(tenantId, volumeParams),
    queryFn: () => fleetApi.consumption(tenantId, volumeParams),
    enabled: can('consumption:read'),
  });
  const sites = useQuery({
    queryKey: fleetKeys.sites(tenantId, { all: true }),
    queryFn: () => fleetApi.allSites(tenantId),
  });

  if (dashboard.isPending) {
    return (
      <div
        className="grid grid-cols-2 gap-4 xl:grid-cols-4"
        role="status"
        aria-label="Chargement du tableau de bord"
      >
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-40 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (dashboard.isError) {
    return <FormError message={dashboard.error.message} />;
  }

  const data = dashboard.data;
  const total = data.totals.printers;
  const filtered = Boolean(siteId || colorMode);

  if (total === 0 && !filtered) {
    return (
      <Panel>
        <EmptyState
          icon={PrinterIcon}
          title="Le parc est vide"
          description="Le tableau de bord se remplit à mesure que vous ajoutez des machines. Commencez par créer un site, puis ajoutez les machines qui s’y trouvent."
          actions={
            <>
              {can('printers:manage') && (
                <Button asChild>
                  <Link href={href('/machines')}>
                    <Plus aria-hidden="true" />
                    Ajouter une machine
                  </Link>
                </Button>
              )}
              {can('sites:manage') && (
                <Button variant="secondary" asChild>
                  <Link href={href('/sites')}>Créer un site</Link>
                </Button>
              )}
            </>
          }
        />
      </Panel>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="min-w-36 flex-1 sm:w-56 sm:flex-none">
          <Select
            aria-label="Site"
            value={siteId}
            onChange={(event) => setSiteId(event.target.value)}
          >
            <option value="">Tous les sites</option>
            {sites.data?.items.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-36 flex-1 sm:w-48 sm:flex-none">
          <Select
            aria-label="Type d’impression"
            value={colorMode}
            onChange={(event) => setColorMode(event.target.value)}
          >
            <option value="">Couleur et N&B</option>
            {COLOR_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {COLOR_MODE_LABELS[mode]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          featured
          className="col-span-2 sm:col-span-1"
          label="Machines du parc"
          value={total}
          href={href('/machines')}
          hint={`${data.totals.color} couleur · ${data.totals.monochrome} noir et blanc`}
        />
        <StatCard
          label={PRINTER_STATUS_LABELS.ACTIVE}
          value={data.byStatus.ACTIVE}
          hint={
            <>
              <StatusDot className="text-success" />
              {share(data.byStatus.ACTIVE, total)} du parc
            </>
          }
        />
        <StatCard
          label={PRINTER_STATUS_LABELS.MAINTENANCE}
          value={data.byStatus.MAINTENANCE}
          hint={
            <>
              <StatusDot className="text-warning" />
              {share(data.byStatus.MAINTENANCE, total)} du parc
            </>
          }
        />
        <StatCard
          label={PRINTER_STATUS_LABELS.OUT_OF_SERVICE}
          value={data.byStatus.OUT_OF_SERVICE}
          hint={
            <>
              <StatusDot className="text-danger" />
              {data.byStatus.RETIRED > 0
                ? `${data.byStatus.RETIRED} retirée${data.byStatus.RETIRED > 1 ? 's' : ''}, hors parc`
                : `${share(data.byStatus.OUT_OF_SERVICE, total)} du parc`}
            </>
          }
        />
      </div>

      {volumes.data && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel className="xl:col-span-2">
            <PanelHeader
              title="Pages imprimées, 30 derniers jours"
              description={
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {numberFormat.format(volumes.data.totals.total)}
                    </span>{' '}
                    pages, dont {numberFormat.format(volumes.data.totals.color)} en couleur
                  </span>
                  <span className="inline-flex items-center gap-1 text-foreground">
                    <Variation
                      current={volumes.data.totals.total}
                      previous={volumes.data.previousTotals.total}
                    />
                    <span className="text-muted-foreground">vs les 30 jours précédents</span>
                  </span>
                </span>
              }
              actions={
                <Button variant="ghost" size="sm" asChild>
                  <Link href={href('/meters')}>
                    Compteurs
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              }
            />
            <div className="space-y-3 px-3 pb-5">
              <VolumeChart series={volumes.data.series} height={200} />
              <div className="flex flex-wrap items-start justify-between gap-3 px-2">
                <CoverageNote coverage={volumes.data.totals.coverage} />
                <ChartLegend />
              </div>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Anomalies de compteurs" description="À vérifier sur le parc" />
            {anomalies.data?.length === 0 && (
              <p className="px-5 pb-6 text-muted-foreground">Aucune anomalie détectée.</p>
            )}
            {anomalies.data && anomalies.data.length > 0 && (
              <ul className="divide-y divide-border/80 border-t border-border/80">
                {anomalies.data.slice(0, 5).map((anomaly) => (
                  <li
                    key={`${anomaly.printerId}-${anomaly.code}-${anomaly.detectedAt}`}
                    className="relative flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-surface-raised"
                  >
                    <Link
                      href={href(`/machines/${anomaly.printerId}`)}
                      className="min-w-0 truncate font-medium after:absolute after:inset-0 hover:underline"
                    >
                      {anomaly.printerName}
                    </Link>
                    <AnomalyBadge anomaly={anomaly} />
                  </li>
                ))}
                {anomalies.data.length > 5 && (
                  <li className="px-5 py-3 text-[13px] text-muted-foreground">
                    et {anomalies.data.length - 5} autre{anomalies.data.length - 5 > 1 ? 's' : ''},{' '}
                    <Link href={href('/meters')} className="text-primary hover:underline">
                      voir les compteurs
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {can('alerts:read') && <AlertsOverview tenantId={tenantId} />}

      {consumption.data && consumption.data.totals.pages > 0 && (
        <Panel>
          <PanelHeader
            title="Toner estimé, 30 derniers jours"
            description={`${formatMoney(consumption.data.totals.costEstimated, consumption.data.currency)} de toner, soit ${formatMoney(consumption.data.totals.costPerPage, consumption.data.currency, true)} par page${consumption.data.totals.completeCost ? '' : ' (prix incomplets)'}`}
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link href={href('/consumption')}>
                  Consommation
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            }
          />
          <ul className="grid gap-x-8 gap-y-5 px-5 pb-6 sm:grid-cols-2 xl:grid-cols-4">
            {consumption.data.channels.map((channel) => {
              const max = Math.max(
                1,
                ...consumption.data.channels.map((item) => item.estimatedGrams),
              );
              return (
                <li key={channel.channel} className="space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <InkLabel channel={channel.channel} className="text-[13px] font-medium" />
                    <span className="font-semibold tabular-nums">
                      {formatGrams(channel.estimatedGrams)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div
                      className={`h-full rounded-full ${INK_CLASSES[channel.channel]}`}
                      style={{ width: `${(channel.estimatedGrams / max) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Théorique {formatGrams(channel.theoreticalGrams)}
                  </p>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PanelHeader
            title="Machines par site"
            description={`${data.totals.sites} site${data.totals.sites > 1 ? 's' : ''} dans l’entreprise`}
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link href={href('/sites')}>
                  Sites
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            }
          />
          <div className="px-3 pb-4">
            {data.bySite.length > 0 ? (
              <SitesChart data={data.bySite} />
            ) : (
              <p className="px-2 pb-2 text-muted-foreground">Aucune machine pour ces filtres.</p>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Collecte SNMP"
            description="Machines interrogées par les agents de collecte"
          />
          <div className="space-y-6 px-5 pb-6">
            <Meter
              value={data.totals.networkConfigured}
              total={total}
              label="Adresse réseau renseignée"
            />
            <Meter
              value={data.byConnectivity.ONLINE}
              total={total}
              label={`En ligne · ${data.byConnectivity.OFFLINE} hors ligne`}
            />
            {data.byConnectivity.UNKNOWN > 0 && (
              <div className="flex items-start gap-3 rounded-lg bg-surface-raised p-4">
                <Network
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="text-[13px] text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    Connectivité non mesurée pour {data.byConnectivity.UNKNOWN} machine
                    {data.byConnectivity.UNKNOWN > 1 ? 's' : ''}.
                  </span>{' '}
                  Aucun agent de collecte ne les a encore interrogées : leur état n’est pas simulé.
                </p>
              </div>
            )}
            {data.byManufacturer.length > 0 && (
              <div>
                <h3 className="mb-2.5 text-[13px] font-semibold">Fabricants</h3>
                <ul className="space-y-2">
                  {data.byManufacturer.slice(0, 5).map((entry) => (
                    <li key={entry.manufacturer} className="flex justify-between gap-3 text-[13px]">
                      <span className="truncate">{entry.manufacturer}</span>
                      <span className="font-medium tabular-nums">{entry.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PanelHeader
            title="À surveiller"
            description="Machines hors service, en maintenance ou sans configuration réseau"
          />
          {data.attention.length === 0 ? (
            <p className="px-5 pb-6 text-muted-foreground">Rien à signaler pour ces filtres.</p>
          ) : (
            <ul className="divide-y divide-border/80 border-t border-border/80">
              {data.attention.map((printer) => (
                <li
                  key={printer.id}
                  className="relative flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 hover:bg-surface-raised"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={href(`/machines/${printer.id}`)}
                      className="font-medium after:absolute after:inset-0 hover:underline"
                    >
                      {printer.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{printer.siteName}</p>
                  </div>
                  {printer.address ? (
                    <span className="font-mono text-[13px] text-muted-foreground">
                      {printer.address}
                    </span>
                  ) : (
                    <span className="text-[13px] text-warning">Réseau non configuré</span>
                  )}
                  <PrinterStatusBadge status={printer.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Indicateurs à venir" description="Livrés avec les phases suivantes" />
          <ul className="space-y-3 px-5 pb-6">
            {UPCOMING.map((item) => (
              <li key={item.label} className="flex items-start justify-between gap-3 text-[13px]">
                <span className="text-muted-foreground">{item.label}</span>
                <span className="shrink-0 rounded-full border border-border px-1.5 text-[11px] leading-5 font-medium text-muted-foreground tabular-nums">
                  P{item.phase}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}

export function DashboardPage() {
  const { tenantId, tenantName } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tableau de bord"
        description={
          tenantName ? `Parc d’impression de ${tenantName}.` : 'Parc d’impression de l’entreprise.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? <Dashboard key={tenantId} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
