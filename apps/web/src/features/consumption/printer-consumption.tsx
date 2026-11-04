'use client';

import {
  MEASUREMENT_METHOD_LABELS,
  channelsFor,
  type ColorMode,
  type ConsumptionMeasurement,
} from '@arksen/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Droplets, Plus, Settings2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormError } from '@/components/ui/field';
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
import { fleetApi, fleetKeys, send } from '@/features/fleet/api';
import { useTenantScope } from '@/features/fleet/tenant-scope';
import { numberFormat } from '@/features/meters/meters-ui';
import { periodRange, type PeriodPreset } from '@/features/meters/periods';
import { useSession } from '@/features/session/session-provider';
import { formatDate } from '@/lib/format';
import { MeasurementDialog, ProfileDialog } from './consumption-dialogs';
import {
  CalibrationBadge,
  InkLabel,
  OriginLegend,
  formatGrams,
  formatMoney,
  formatSignedPercent,
} from './consumption-ui';

const PERIODS: [PeriodPreset, string][] = [
  ['30d', '30 derniers jours'],
  ['90d', '3 derniers mois'],
  ['12m', '12 derniers mois'],
];

function measurementPeriod(measurement: ConsumptionMeasurement): string {
  const end = new Date(new Date(measurement.periodEnd).getTime() - 86_400_000);
  return `${formatDate(measurement.periodStart)} – ${formatDate(end.toISOString())}`;
}

/** Consommation toner d'une machine : canaux, calibration, paramètres et consommations réelles. */
export function PrinterConsumption({
  tenantId,
  printerId,
  colorMode,
  modelId,
}: {
  tenantId: string;
  printerId: string;
  colorMode: ColorMode;
  modelId: string;
}) {
  const { can } = useSession();
  const { href } = useTenantScope();
  const queryClient = useQueryClient();
  const canManage = can('consumption:manage');
  const [preset, setPreset] = useState<PeriodPreset>('90d');
  const [editingProfile, setEditingProfile] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [deleting, setDeleting] = useState<ConsumptionMeasurement | null>(null);
  const range = periodRange(preset);
  const base = `/tenants/${tenantId}/printers/${printerId}`;

  const consumption = useQuery({
    queryKey: fleetKeys.consumption(tenantId, { printerId, ...range }),
    queryFn: () => fleetApi.printerConsumption(tenantId, printerId, range),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: fleetKeys.all(tenantId) });
  const data = consumption.data;
  const channels = channelsFor(colorMode);

  return (
    <Panel aria-labelledby="consumption-title">
      <PanelHeader
        title={<span id="consumption-title">Consommation toner</span>}
        description="D’après les compteurs et l’aplat moyen de la machine"
        actions={
          <>
            <div className="w-44">
              <Select
                aria-label="Période"
                value={preset}
                onChange={(event) => setPreset(event.target.value as PeriodPreset)}
              >
                {PERIODS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            {canManage && data && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setEditingProfile(true)}>
                  <Settings2 aria-hidden="true" />
                  Paramètres
                </Button>
                <Button size="sm" onClick={() => setMeasuring(true)}>
                  <Plus aria-hidden="true" />
                  Consommation réelle
                </Button>
              </>
            )}
          </>
        }
      />

      {consumption.isPending && <Skeleton className="mx-5 mb-5 h-40" />}
      {consumption.isError && (
        <div className="px-5 pb-5">
          <FormError message={consumption.error.message} />
        </div>
      )}

      {data?.gap === 'NO_TONER_SPECS' && (
        <EmptyState
          icon={Droplets}
          title="Toners non renseignés"
          description="Le calcul a besoin de la masse et du rendement de chaque toner de ce modèle. Renseignez-les dans la fiche technique."
          actions={
            <Button variant="secondary" asChild>
              <Link href={href(`/printer-models?toners=${modelId}`)}>
                Ouvrir les fiches techniques
              </Link>
            </Button>
          }
        />
      )}

      {data && data.gap !== 'NO_TONER_SPECS' && (
        <>
          <div className="flex flex-wrap gap-x-8 gap-y-3 px-5 pb-4 text-[13px]">
            <p>
              <span className="text-muted-foreground">Pages : </span>
              <span className="font-semibold tabular-nums">
                {data.pages.coverage === 0 ? 'inconnues' : numberFormat.format(data.pages.total)}
              </span>
              {colorMode === 'COLOR' && data.pages.coverage > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  dont {numberFormat.format(data.pages.color)} couleur
                </span>
              )}
            </p>
            <p>
              <span className="text-muted-foreground">Toner estimé : </span>
              <span className="font-semibold">
                {data.totals ? formatGrams(data.totals.estimatedGrams) : '—'}
              </span>
            </p>
            <p>
              <span className="text-muted-foreground">Coût par page : </span>
              <span className="font-semibold">
                {formatMoney(data.totals?.costPerPage ?? null, data.currency, true)}
              </span>
            </p>
            <p className="text-muted-foreground">
              Format {data.profile.paperFormat}, support ×{' '}
              {String(data.profile.mediaFactor).replace('.', ',')}
              {data.profile.isDefault && ' (paramètres par défaut)'}
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Encre</TableHead>
                <TableHead className="text-right">Aplat moyen</TableHead>
                <TableHead className="text-right">Théorique</TableHead>
                <TableHead>Calibration</TableHead>
                <TableHead className="text-right">Estimé</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Pour 1 000 pages</TableHead>
                <TableHead className="hidden text-right md:table-cell">Coût</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.channels.map((channel) => (
                <TableRow key={channel.channel}>
                  <TableCell>
                    <InkLabel channel={channel.channel} className="font-medium" />
                  </TableCell>
                  <TableCell className="text-right">
                    {String(channel.coverage).replace('.', ',')} %
                  </TableCell>
                  <TableCell className="text-right">
                    {formatGrams(channel.theoreticalGrams)}
                  </TableCell>
                  <TableCell>
                    <CalibrationBadge calibration={channel.calibration} />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatGrams(channel.estimatedGrams)}
                  </TableCell>
                  <TableCell className="hidden text-right lg:table-cell">
                    {formatGrams(channel.estimatedGramsPer1000Pages)}
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    {formatMoney(channel.costEstimated, data.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="px-5 pt-6 pb-3">
            <h3 className="text-[15px] font-semibold">Consommations réelles</h3>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Comparées à la consommation théorique de la même période. Elles calibrent la machine.
            </p>
          </div>
          {data.measurements.length === 0 ? (
            <p className="px-5 pb-6 text-[13px] text-muted-foreground">
              Aucune consommation réelle enregistrée : le calcul reste théorique, sans calibration.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Période</TableHead>
                  <TableHead>Encre</TableHead>
                  <TableHead className="hidden md:table-cell">Méthode</TableHead>
                  <TableHead className="text-right">Réel</TableHead>
                  <TableHead className="text-right">Théorique</TableHead>
                  <TableHead className="text-right">Écart</TableHead>
                  {canManage && (
                    <TableHead className="text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.measurements.map((measurement) => (
                  <TableRow key={measurement.id}>
                    <TableCell className="whitespace-nowrap">
                      {measurementPeriod(measurement)}
                      <p className="text-xs text-muted-foreground">
                        {measurement.pages.coverage === 0
                          ? 'Pages inconnues'
                          : `${numberFormat.format(measurement.pages.total)} pages`}
                      </p>
                    </TableCell>
                    <TableCell>
                      <InkLabel channel={measurement.channel} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {MEASUREMENT_METHOD_LABELS[measurement.method]}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatGrams(measurement.grams)}
                    </TableCell>
                    <TableCell className="text-right">
                      {measurement.theoreticalGrams === null
                        ? '—'
                        : formatGrams(measurement.theoreticalGrams)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {measurement.deviationRatio === null ? (
                        '—'
                      ) : (
                        <span
                          className={
                            measurement.deviationRatio > 0
                              ? 'font-medium text-warning'
                              : 'font-medium'
                          }
                        >
                          {formatSignedPercent(measurement.deviationRatio)}
                        </span>
                      )}
                      {measurement.deviationGrams !== null && (
                        <p className="text-xs text-muted-foreground">
                          {measurement.deviationGrams > 0 ? '+' : ''}
                          {formatGrams(measurement.deviationGrams)}
                        </p>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Supprimer cette consommation réelle"
                          title="Supprimer"
                          onClick={() => setDeleting(measurement)}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="border-t border-border/80 px-5 py-5">
            <OriginLegend />
          </div>
        </>
      )}

      {data && editingProfile && (
        <ProfileDialog
          open={editingProfile}
          onOpenChange={setEditingProfile}
          channels={channels}
          profile={data.profile}
          onSubmit={async (values) => {
            await send('PUT', `${base}/calibration`, values);
            await refresh();
          }}
        />
      )}
      {measuring && (
        <MeasurementDialog
          open={measuring}
          onOpenChange={setMeasuring}
          channels={channels}
          onSubmit={async (values) => {
            await send('POST', `${base}/consumption-measurements`, values);
            await refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Supprimer cette consommation réelle ?"
        description="La calibration sera recalculée sans elle. La suppression est tracée dans le journal d’audit."
        confirmLabel="Supprimer"
        onConfirm={async () => {
          await send<void>('DELETE', `${base}/consumption-measurements/${deleting!.id}`);
          await refresh();
        }}
      />
    </Panel>
  );
}
