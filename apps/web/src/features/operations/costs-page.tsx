'use client';

import { COST_GAP_LABELS, type PrinterCost } from '@arksen/shared-types';
import { printerCostSettingsSchema } from '@arksen/validation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Receipt, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
import { useSession } from '@/features/session/session-provider';
import { FormDialog, firstIssue } from '@/features/stocks/stock-dialogs';
import { formatDate } from '@/lib/format';
import { opsApi, opsKeys } from './api';
import { lastDays, money, pageCost, PeriodPicker, type Period } from './ops-ui';

const PARTS = [
  { key: 'toner', label: 'Toner', className: 'bg-chart-3' },
  { key: 'paper', label: 'Papier', className: 'bg-chart-2' },
  { key: 'maintenance', label: 'Interventions', className: 'bg-chart-4' },
  { key: 'fixed', label: 'Coûts fixes', className: 'bg-chart-5' },
] as const;

function SettingsDialog({
  tenantId,
  cost,
  onClose,
}: {
  tenantId: string;
  cost: PrinterCost | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const papers = useQuery({
    queryKey: opsKeys.key(tenantId, 'paper-types'),
    queryFn: () => opsApi.paperTypes(tenantId),
    enabled: cost !== null,
  });
  const current = values ?? {
    paperTypeId: cost?.settings.paperTypeId ?? '',
    duplexPercent: String(cost?.settings.duplexPercent ?? 0),
    monthlyFixedCost:
      cost?.settings.monthlyFixedCost === null ? '' : String(cost?.settings.monthlyFixedCost ?? ''),
  };
  const set = (key: string) => (value: string) => setValues({ ...current, [key]: value });
  return (
    <FormDialog
      open={cost !== null}
      onOpenChange={(open) => {
        if (!open) {
          setValues(null);
          onClose();
        }
      }}
      title={cost ? `Coûts de ${cost.printer.name}` : ''}
      description="Ce qui s’ajoute au toner pour calculer le coût copie de la machine."
      submitLabel="Enregistrer"
      onSubmit={async () => {
        if (!cost) return null;
        const parsed = printerCostSettingsSchema.safeParse(current);
        if (!parsed.success) return firstIssue(parsed.error);
        await opsApi.saveCostSettings(tenantId, cost.printer.id, parsed.data);
        await queryClient.invalidateQueries({ queryKey: opsKeys.all(tenantId) });
        setValues(null);
        return null;
      }}
    >
      <Field id="cost-paper" label="Papier" hint="Son prix de rame donne le coût du papier.">
        <Select
          id="cost-paper"
          value={current.paperTypeId}
          onChange={(e) => set('paperTypeId')(e.target.value)}
        >
          <option value="">Non renseigné</option>
          {papers.data?.map((paper) => (
            <option key={paper.id} value={paper.id}>
              {paper.name} · {paper.format}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="cost-duplex"
          label="Part de recto verso"
          hint="% des pages ; deux pages par feuille"
        >
          <Input
            id="cost-duplex"
            inputMode="decimal"
            value={current.duplexPercent}
            onChange={(e) => set('duplexPercent')(e.target.value)}
          />
        </Field>
        <Field id="cost-fixed" label="Coûts fixes par mois" hint="Location, amortissement, forfait">
          <Input
            id="cost-fixed"
            inputMode="decimal"
            value={current.monthlyFixedCost}
            onChange={(e) => set('monthlyFixedCost')(e.target.value)}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

function CostsView({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const { href } = useTenantScope();
  const [period, setPeriod] = useState<Period>(lastDays(30));
  const [siteId, setSiteId] = useState('');
  const [editing, setEditing] = useState<PrinterCost | null>(null);
  const params = { ...period, siteId: siteId || undefined };
  const report = useQuery({
    queryKey: opsKeys.key(tenantId, 'costs', params),
    queryFn: () => opsApi.costs(tenantId, params),
    placeholderData: keepPreviousData,
  });
  const sites = useQuery({
    queryKey: fleetKeys.sites(tenantId, { all: true }),
    queryFn: () => fleetApi.allSites(tenantId),
  });
  const data = report.data;
  const totals = data?.totals;
  const currency = data?.currency ?? 'XOF';

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
        <Select
          aria-label="Site"
          className="w-auto min-w-44"
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
        >
          <option value="">Tous les sites</option>
          {sites.data?.items.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </Select>
      </div>
      {report.isError && <FormError message={report.error.message} />}
      {report.isPending && <Skeleton className="h-40" />}
      {totals && data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              featured
              compact
              label="Coût d’impression"
              value={money(totals.total, currency, 0)}
              hint={`${numberFormat.format(Math.round(totals.pages))} pages, du ${formatDate(data.from)} au ${formatDate(data.to)}`}
            />
            <StatCard
              compact
              label="Coût moyen par page"
              value={pageCost(totals.costPerPage, currency)}
              hint="Toutes pages confondues"
            />
            <StatCard
              compact
              label="Coût copie noir et blanc"
              value={pageCost(totals.costPerBlackPage, currency)}
              hint="Toner noir et coûts communs"
            />
            <StatCard
              compact
              label="Coût copie couleur"
              value={pageCost(totals.costPerColorPage, currency)}
              hint="Avec les toners cyan, magenta et jaune"
            />
          </div>

          <Panel>
            <PanelHeader
              title="Répartition"
              description="Toner estimé par le moteur CMJN, papier, interventions terminées et coûts fixes au prorata de la période"
            />
            <div className="px-5 pb-6">
              <div className="flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                {PARTS.map((part) => {
                  const value = totals[part.key] ?? 0;
                  return totals.total > 0 && value > 0 ? (
                    <span
                      key={part.key}
                      className={part.className}
                      style={{ width: `${(value / totals.total) * 100}%` }}
                    />
                  ) : null;
                })}
              </div>
              <ul className="mt-4 grid gap-3 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
                {PARTS.map((part) => (
                  <li key={part.key} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <span
                        className={`size-2.5 rounded-full ${part.className}`}
                        aria-hidden="true"
                      />
                      {part.label}
                    </span>
                    <span className="font-medium tabular-nums">
                      {money(totals[part.key], currency, 0)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Par machine"
              description="Coût copie de chaque machine sur la période"
            />
            {data.printers.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="Aucune machine"
                description="Ajoutez des machines et relevez leurs compteurs."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Machine</TableHead>
                    <TableHead className="text-right">Pages</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Toner</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Papier</TableHead>
                    <TableHead className="hidden text-right xl:table-cell">Interventions</TableHead>
                    <TableHead className="hidden text-right xl:table-cell">Fixes</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Coût copie</TableHead>
                    {can('costs:manage') && <TableHead className="w-0" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.printers.map((cost) => (
                    <TableRow key={cost.printer.id}>
                      <TableCell>
                        <Link
                          className="font-medium hover:underline"
                          href={href(`/machines/${cost.printer.id}`)}
                        >
                          {cost.printer.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{cost.printer.siteName}</p>
                        {cost.gaps.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {cost.gaps.map((gap) => (
                              <Badge key={gap} tone="warning">
                                {COST_GAP_LABELS[gap]}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {numberFormat.format(Math.round(cost.pages))}
                        {cost.printer.colorMode === 'COLOR' && (
                          <p className="text-xs whitespace-nowrap text-muted-foreground">
                            {numberFormat.format(Math.round(cost.colorPages))} couleur
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">
                        {money(cost.toner, currency, 0)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">
                        {money(cost.paper, currency, 0)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums xl:table-cell">
                        {money(cost.maintenance, currency, 0)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums xl:table-cell">
                        {money(cost.fixed, currency, 0)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {money(cost.total, currency, 0)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {pageCost(cost.costPerBlackPage, currency)}
                        {cost.printer.colorMode === 'COLOR' && (
                          <p className="text-xs text-muted-foreground">
                            couleur {pageCost(cost.costPerColorPage, currency)}
                          </p>
                        )}
                      </TableCell>
                      {can('costs:manage') && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Coûts de ${cost.printer.name}`}
                            onClick={() => setEditing(cost)}
                          >
                            <Settings2 aria-hidden="true" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </>
      )}
      <SettingsDialog tenantId={tenantId} cost={editing} onClose={() => setEditing(null)} />
    </>
  );
}

export function CostsPage() {
  const { tenantId, tenantName } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Coûts d’impression"
        description={
          tenantName
            ? `Coût de revient et coût copie du parc de ${tenantName}.`
            : 'Coût de revient et coût copie du parc.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? <CostsView key={tenantId} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
