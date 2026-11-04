'use client';

import {
  CMYK_CHANNELS,
  CMYK_LABELS,
  COLOR_MODE_LABELS,
  COLOR_MODES,
  CONSUMPTION_GAP_LABELS,
  type CmykChannel,
} from '@arksen/shared-types';
import { useQuery } from '@tanstack/react-query';
import { Droplets } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
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
import { numberFormat } from '@/features/meters/meters-ui';
import {
  PERIOD_PRESETS,
  periodRange,
  rangeLabel,
  type PeriodPreset,
} from '@/features/meters/periods';
import { INK_CLASSES, InkLabel, OriginLegend, formatGrams, formatMoney } from './consumption-ui';

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

function Consumption({ tenantId }: { tenantId: string }) {
  const { href } = useTenantScope();
  const [preset, setPreset] = useState<PeriodPreset>('30d');
  const [siteId, setSiteId] = useState('');
  const [colorMode, setColorMode] = useState('');
  const params = { ...periodRange(preset), siteId, colorMode };

  const consumption = useQuery({
    queryKey: fleetKeys.consumption(tenantId, params),
    queryFn: () => fleetApi.consumption(tenantId, params),
  });
  const sites = useQuery({
    queryKey: fleetKeys.sites(tenantId, { all: true }),
    queryFn: () => fleetApi.allSites(tenantId),
  });

  const data = consumption.data;
  const maxGrams = data
    ? Math.max(1, ...data.channels.map((channel) => channel.estimatedGrams))
    : 1;
  const unconfigured =
    data?.printers.filter((printer) => printer.gap === 'NO_TONER_SPECS').length ?? 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <Filter
          label="Période"
          value={preset}
          onChange={(value) => setPreset(value as PeriodPreset)}
          options={PERIOD_PRESETS.map((item) => [item.value, item.label])}
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

      {consumption.isError && <FormError message={consumption.error.message} />}
      {!data && !consumption.isError && (
        <div
          className="grid grid-cols-2 gap-4 xl:grid-cols-4"
          role="status"
          aria-label="Calcul de la consommation"
        >
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-40 rounded-2xl" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard
              featured
              className="col-span-2 sm:col-span-1"
              label="Toner consommé, estimé"
              value={formatGrams(data.totals.estimatedGrams)}
              hint={`${formatGrams(data.totals.theoreticalGrams)} en théorique`}
            />
            <StatCard
              compact
              label="Coût toner estimé"
              value={formatMoney(data.totals.costEstimated, data.currency)}
              hint={
                data.totals.completeCost
                  ? 'Tous les prix sont renseignés'
                  : 'Partiel : des prix manquent'
              }
            />
            <StatCard
              compact
              label="Coût toner par page"
              value={formatMoney(data.totals.costPerPage, data.currency, true)}
              hint="Moyenne sur toutes les pages"
            />
            <StatCard
              label="Pages prises en compte"
              value={numberFormat.format(data.totals.pages)}
              hint={rangeLabel(data.from, data.to)}
            />
          </div>

          <Panel>
            <PanelHeader
              title="Consommation par canal"
              description="Chaque encre est calculée indépendamment"
            />
            <ul className="grid gap-x-8 gap-y-6 px-5 pb-6 sm:grid-cols-2 xl:grid-cols-4">
              {data.channels.map((channel) => (
                <li key={channel.channel} className="space-y-3">
                  <InkLabel channel={channel.channel} className="font-semibold" />
                  <p className="text-[1.75rem] leading-none font-semibold tracking-[-0.03em] tabular-nums">
                    {formatGrams(channel.estimatedGrams)}
                  </p>
                  <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div
                      className={`h-full rounded-full ${INK_CLASSES[channel.channel]}`}
                      style={{ width: `${(channel.estimatedGrams / maxGrams) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Théorique {formatGrams(channel.theoreticalGrams)} ·{' '}
                    {formatMoney(channel.costEstimated, data.currency)}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader
              title="Par machine"
              description="Toner estimé par canal, en grammes, et coût par page"
            />
            {data.printers.length === 0 ? (
              <EmptyState
                icon={Droplets}
                title="Aucune machine"
                description="Aucune machine ne correspond à ces filtres."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Machine</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Pages</TableHead>
                    {CMYK_CHANNELS.map((channel) => (
                      <TableHead key={channel} className="hidden text-right lg:table-cell">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`size-2 rounded-full ${INK_CLASSES[channel]}`}
                            aria-hidden="true"
                          />
                          {CMYK_LABELS[channel]}
                        </span>
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Coût / page</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.printers.map((printer) => {
                    const byChannel = new Map(printer.channels.map((item) => [item.channel, item]));
                    return (
                      <TableRow key={printer.printerId} className="relative">
                        <TableCell>
                          <Link
                            href={href(`/machines/${printer.printerId}`)}
                            className="font-medium after:absolute after:inset-0 hover:underline"
                          >
                            {printer.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">{printer.siteName}</p>
                        </TableCell>
                        <TableCell className="hidden text-right md:table-cell">
                          {printer.pages.coverage === 0
                            ? '—'
                            : numberFormat.format(printer.pages.total)}
                        </TableCell>
                        {printer.gap ? (
                          <TableCell colSpan={6} className="text-right">
                            <Badge tone={printer.gap === 'NO_TONER_SPECS' ? 'warning' : 'neutral'}>
                              {CONSUMPTION_GAP_LABELS[printer.gap]}
                            </Badge>
                          </TableCell>
                        ) : (
                          <>
                            {CMYK_CHANNELS.map((channel: CmykChannel) => (
                              <TableCell key={channel} className="hidden text-right lg:table-cell">
                                {byChannel.has(channel)
                                  ? formatGrams(byChannel.get(channel)!.estimatedGrams)
                                  : '—'}
                              </TableCell>
                            ))}
                            <TableCell className="text-right font-medium">
                              {formatGrams(printer.totals!.estimatedGrams)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatMoney(printer.totals!.costPerPage, data.currency, true)}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Panel>

          <Panel className="p-5">
            <OriginLegend />
            {unconfigured > 0 && (
              <p className="mt-4 text-[13px] text-warning">
                {unconfigured} machine{unconfigured > 1 ? 's' : ''} sans toners renseignés :
                complétez leur{' '}
                <Link href={href('/printer-models')} className="underline">
                  fiche technique
                </Link>{' '}
                pour les inclure dans le calcul.
              </p>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

export function ConsumptionPage() {
  const { tenantId, tenantName } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Consommation toner"
        description={
          tenantName
            ? `Toner consommé par le parc de ${tenantName}, canal par canal, d’après les compteurs et l’aplat de chaque machine.`
            : 'Toner consommé par le parc, canal par canal.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? <Consumption key={tenantId} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
