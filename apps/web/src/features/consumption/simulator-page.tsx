'use client';

import {
  CMYK_CHANNELS,
  PAPER_FORMATS,
  channelsFor,
  type CmykChannel,
  type ConsumptionSimulation,
} from '@arksen/shared-types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Calculator } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
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
import { errorMessage } from '@/lib/api';
import { CalibrationBadge, INK_VARS, InkLabel, formatGrams, formatMoney } from './consumption-ui';

type Target = { kind: 'printer' | 'model'; id: string };

function CoverageSlider({
  channel,
  value,
  onChange,
}: {
  channel: CmykChannel;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = `coverage-${channel}`;
  return (
    <div className="grid grid-cols-[6.5rem_1fr_5.5rem] items-center gap-3">
      <label htmlFor={id}>
        <InkLabel channel={channel} className="text-sm font-medium" />
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 w-full cursor-pointer"
        style={{ accentColor: INK_VARS[channel] }}
      />
      <div className="relative">
        <Input
          aria-label={`Aplat ${channel}`}
          inputMode="decimal"
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value.replace(',', '.'));
            if (Number.isFinite(next)) onChange(Math.min(100, Math.max(0, next)));
          }}
          className="h-9 pr-7 text-right tabular-nums"
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-muted-foreground">
          %
        </span>
      </div>
    </div>
  );
}

function Simulator({ tenantId }: { tenantId: string }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [pages, setPages] = useState('1000');
  const [colorPages, setColorPages] = useState('1000');
  const [coverage, setCoverage] = useState<Record<CmykChannel, number>>({
    CYAN: 5,
    MAGENTA: 5,
    YELLOW: 5,
    BLACK: 5,
  });
  const [paperFormat, setPaperFormat] = useState<(typeof PAPER_FORMATS)[number]>('A4');
  const [mediaFactor, setMediaFactor] = useState('1');
  const [useCalibration, setUseCalibration] = useState(true);

  const printers = useQuery({
    queryKey: fleetKeys.printers(tenantId, { all: true }),
    queryFn: () => fleetApi.printers(tenantId, { pageSize: 100 }),
  });
  const models = useQuery({
    queryKey: fleetKeys.models(tenantId, { all: true }),
    queryFn: () => fleetApi.models(tenantId, { pageSize: 100 }),
  });

  const colorMode = useMemo(() => {
    if (!target) return null;
    return target.kind === 'printer'
      ? (printers.data?.items.find((item) => item.id === target.id)?.model.colorMode ?? null)
      : (models.data?.items.find((item) => item.id === target.id)?.colorMode ?? null);
  }, [target, printers.data, models.data]);
  const channels = colorMode ? channelsFor(colorMode) : CMYK_CHANNELS;

  const simulation = useMutation({
    mutationFn: () =>
      fleetApi.simulate(tenantId, {
        ...(target!.kind === 'printer' ? { printerId: target!.id } : { modelId: target!.id }),
        pages: Number(pages),
        colorPages: colorMode === 'MONOCHROME' ? 0 : Number(colorPages),
        coverage,
        paperFormat,
        mediaFactor: Number(mediaFactor.replace(',', '.')),
        useCalibration: target!.kind === 'printer' && useCalibration,
      }),
  });
  const result: ConsumptionSimulation | undefined = simulation.data;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
      <Panel>
        <PanelHeader
          title="Travail à imprimer"
          description="Machine, volume et aplat de chaque encre"
        />
        <form
          noValidate
          className="grid gap-5 px-5 pb-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (target) simulation.mutate();
          }}
        >
          <Field id="simulation-target" label="Machine ou modèle">
            <Select
              id="simulation-target"
              value={target ? `${target.kind}:${target.id}` : ''}
              onChange={(event) => {
                const [kind, id] = event.target.value.split(':');
                setTarget(id ? { kind: kind as Target['kind'], id } : null);
                simulation.reset();
              }}
            >
              <option value="">Choisir…</option>
              <optgroup label="Machines du parc">
                {printers.data?.items.map((printer) => (
                  <option key={printer.id} value={`printer:${printer.id}`}>
                    {printer.name} · {printer.site.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Fiches techniques">
                {models.data?.items.map((model) => (
                  <option key={model.id} value={`model:${model.id}`}>
                    {model.manufacturer} {model.name}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field id="simulation-pages" label="Pages">
              <Input
                id="simulation-pages"
                inputMode="numeric"
                value={pages}
                onChange={(event) => setPages(event.target.value)}
              />
            </Field>
            <Field id="simulation-color" label="Dont couleur">
              <Input
                id="simulation-color"
                inputMode="numeric"
                disabled={colorMode === 'MONOCHROME'}
                value={colorMode === 'MONOCHROME' ? '0' : colorPages}
                onChange={(event) => setColorPages(event.target.value)}
              />
            </Field>
          </div>
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-[13px] font-medium">Aplat par encre</legend>
            {channels.map((channel) => (
              <CoverageSlider
                key={channel}
                channel={channel}
                value={coverage[channel]}
                onChange={(value) => setCoverage((current) => ({ ...current, [channel]: value }))}
              />
            ))}
          </fieldset>
          <div className="grid grid-cols-2 gap-4">
            <Field id="simulation-format" label="Format">
              <Select
                id="simulation-format"
                value={paperFormat}
                onChange={(event) => setPaperFormat(event.target.value as typeof paperFormat)}
              >
                {PAPER_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="simulation-media" label="Facteur de support" hint="1 : papier standard">
              <Input
                id="simulation-media"
                inputMode="decimal"
                value={mediaFactor}
                onChange={(event) => setMediaFactor(event.target.value)}
              />
            </Field>
          </div>
          {target?.kind === 'printer' && (
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--primary)]"
                checked={useCalibration}
                onChange={(event) => setUseCalibration(event.target.checked)}
              />
              <span>
                <span className="font-medium">Appliquer la calibration de la machine</span>
                <span className="block text-[13px] text-muted-foreground">
                  Corrige le théorique avec les consommations réelles mesurées.
                </span>
              </span>
            </label>
          )}
          <FormError
            message={
              simulation.isError ? errorMessage(simulation.error, 'Calcul impossible.') : null
            }
          />
          <Button type="submit" disabled={!target || simulation.isPending}>
            <Calculator aria-hidden="true" />
            {simulation.isPending ? 'Calcul…' : 'Calculer la consommation'}
          </Button>
        </form>
      </Panel>

      <div className="space-y-4">
        {!result ? (
          <Panel>
            <EmptyState
              icon={Calculator}
              title="Aucun calcul"
              description="Choisissez une machine ou un modèle, décrivez le travail et lancez le calcul. La machine doit avoir les toners de sa fiche technique renseignés."
            />
          </Panel>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="hero-surface col-span-2 rounded-2xl p-5 sm:col-span-1">
                <p className="text-[15px] font-medium">Coût toner du travail</p>
                <p className="mt-5 text-[2.5rem] leading-none font-semibold tracking-[-0.035em] tabular-nums">
                  {formatMoney(result.totals.costEstimated, result.currency)}
                </p>
                <p className="mt-3 text-[13px] text-hero-muted">
                  {formatMoney(result.totals.costPerPage, result.currency, true)} par page
                  {!result.totals.completeCost && ' · prix incomplets'}
                </p>
              </div>
              <div className="col-span-2 rounded-2xl border border-border/70 bg-surface p-5 shadow-panel sm:col-span-1">
                <p className="text-[15px] font-medium">Toner consommé</p>
                <p className="mt-5 text-[2.5rem] leading-none font-semibold tracking-[-0.035em] tabular-nums">
                  {formatGrams(result.totals.estimatedGrams)}
                </p>
                <p className="mt-3 text-[13px] text-muted-foreground">
                  {formatGrams(result.totals.theoreticalGrams)} en théorique, pour{' '}
                  {numberFormat.format(result.pages)} pages
                </p>
              </div>
            </div>
            <Panel>
              <PanelHeader
                title="Détail par encre"
                description="Chaque canal est calculé indépendamment"
              />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Encre</TableHead>
                    <TableHead className="text-right">Aplat</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">Pages</TableHead>
                    <TableHead className="text-right">Théorique</TableHead>
                    <TableHead className="hidden md:table-cell">Calibration</TableHead>
                    <TableHead className="text-right">Estimé</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">
                      Pour 1 000 pages
                    </TableHead>
                    <TableHead className="text-right">Coût</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.channels.map((channel) => (
                    <TableRow key={channel.channel}>
                      <TableCell>
                        <InkLabel channel={channel.channel} className="font-medium" />
                      </TableCell>
                      <TableCell className="text-right">{channel.coverage} %</TableCell>
                      <TableCell className="hidden text-right 2xl:table-cell">
                        {numberFormat.format(channel.relevantPages)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatGrams(channel.theoreticalGrams)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <CalibrationBadge calibration={channel.calibration} />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatGrams(channel.estimatedGrams)}
                      </TableCell>
                      <TableCell className="hidden text-right 2xl:table-cell">
                        {formatGrams(channel.estimatedGramsPer1000Pages)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoney(channel.costEstimated, result.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          </>
        )}
        <Panel className="p-5 text-[13px] text-muted-foreground">
          <p className="font-semibold text-foreground">Méthode de calcul</p>
          <p className="mt-2">
            Consommation de référence par page = masse du toner ÷ rendement constructeur, mesuré à
            la couverture de référence (5 % selon ISO/IEC 19752 et 19798).
          </p>
          <p className="mt-1.5">
            Consommation théorique = référence × (aplat ÷ couverture de référence) × pages × facteur
            de format × facteur de support. Le noir s’imprime sur toutes les pages, les couleurs sur
            les pages couleur seulement.
          </p>
          <p className="mt-1.5">
            L’aplat est ici une donnée saisie. Sa mesure dans les fichiers PDF arrive en phase 6.
          </p>
        </Panel>
      </div>
    </div>
  );
}

export function SimulatorPage() {
  const { tenantId } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Aplat CMJN"
        description="Estimez le toner et le coût d’un travail à partir de l’aplat de chaque encre."
        actions={<TenantPicker />}
      />
      {tenantId ? <Simulator key={tenantId} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
