'use client';

import {
  REPORT_FORMAT_LABELS,
  REPORT_FORMATS,
  REPORT_TYPES,
  REPORTS,
  type ReportFormat,
  type ReportType,
  type Statistics,
} from '@arksen/shared-types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, FileBarChart, LoaderCircle, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
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
import { numberFormat } from '@/features/meters/meters-ui';
import { lastDays, money, pageCost, PeriodPicker, type Period } from '@/features/operations/ops-ui';
import { useSession } from '@/features/session/session-provider';
import { apiDownload, apiFetch, errorMessage, queryString } from '@/lib/api';

const tooltipStyle = {
  backgroundColor: 'var(--surface)',
  borderColor: 'var(--border)',
  borderRadius: 12,
  color: 'var(--foreground)',
  fontSize: 13,
};
const axisTick = { fill: 'var(--muted-foreground)', fontSize: 12 };

const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

function ReportCard({
  tenantId,
  type,
  params,
}: {
  tenantId: string;
  type: ReportType;
  params: Record<string, string | undefined>;
}) {
  const report = REPORTS[type];
  const [pending, setPending] = useState<ReportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: ReportFormat) {
    setPending(format);
    setError(null);
    try {
      const query = report.period ? { ...params, format } : { siteId: params.siteId, format };
      await apiDownload(
        `/tenants/${tenantId}/reports/${type}${queryString(query)}`,
        `arksen-${type}.${format}`,
      );
    } catch (failure) {
      setError(errorMessage(failure, 'Le rapport n’a pas pu être produit.'));
    } finally {
      setPending(null);
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-surface p-5 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold tracking-[-0.01em]">{report.title}</h3>
        {!report.period && <Badge>À la date du jour</Badge>}
      </div>
      <p className="flex-1 text-[13px] text-muted-foreground">{report.description}</p>
      {error && <FormError message={error} />}
      <div className="flex flex-wrap gap-2">
        {REPORT_FORMATS.map((format) => (
          <Button
            key={format}
            variant={format === 'pdf' ? 'primary' : 'secondary'}
            size="sm"
            disabled={pending !== null}
            aria-label={`${report.title} en ${REPORT_FORMAT_LABELS[format]}`}
            onClick={() => void download(format)}
          >
            {pending === format ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Download aria-hidden="true" />
            )}
            {REPORT_FORMAT_LABELS[format]}
          </Button>
        ))}
      </div>
    </article>
  );
}

function StatisticsPanel({ tenantId, siteId }: { tenantId: string; siteId: string }) {
  const [months, setMonths] = useState('6');
  const params = { months, siteId: siteId || undefined };
  const query = useQuery({
    queryKey: [...fleetKeys.all(tenantId), 'statistics', params],
    queryFn: () => apiFetch<Statistics>(`/tenants/${tenantId}/statistics${queryString(params)}`),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const currency = data?.currency ?? 'XOF';
  const totals = data?.months.reduce(
    (sum, month) => ({
      pages: sum.pages + month.pages,
      cost: sum.cost + month.totalCost,
      revenue: sum.revenue + month.revenue,
    }),
    { pages: 0, cost: 0, revenue: 0 },
  );
  // Chaque contrat face au coût de ses propres machines : le coût du parc entier inclut des
  // machines hors contrat, et donnerait une marge sans signification.
  const contracts = (data?.clients ?? []).reduce(
    (sum, client) => ({
      revenue: sum.revenue + client.revenue,
      margin: sum.margin + client.margin,
    }),
    { revenue: 0, margin: 0 },
  );
  const chartData = data?.months.map((month) => ({
    label: monthLabel(month.month),
    black: month.pages - month.colorPages,
    color: month.colorPages,
    cost: Math.round(month.totalCost),
    revenue: Math.round(month.revenue),
  }));

  return (
    <section className="space-y-4" aria-labelledby="statistics-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="statistics-title" className="text-lg font-semibold tracking-[-0.01em]">
            Statistiques
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Mois par mois : volumes, coût de revient et chiffre d’affaires des relevés émis.
          </p>
        </div>
        <Select
          aria-label="Fenêtre"
          className="w-auto min-w-40"
          value={months}
          onChange={(event) => setMonths(event.target.value)}
        >
          <option value="3">3 derniers mois</option>
          <option value="6">6 derniers mois</option>
          <option value="12">12 derniers mois</option>
        </Select>
      </div>
      {query.isError && (
        <FormError message={errorMessage(query.error, 'Statistiques indisponibles.')} />
      )}
      {query.isPending && <Skeleton className="h-72" />}
      {data && totals && chartData && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              compact
              label="Pages imprimées"
              value={numberFormat.format(totals.pages)}
              hint={`Sur ${data.months.length} mois`}
            />
            <StatCard
              compact
              label="Coût de revient du parc"
              value={money(totals.cost, currency, 0)}
              hint="Toner, papier, interventions, coûts fixes"
            />
            <StatCard
              compact
              label="Chiffre d’affaires"
              value={money(totals.revenue, currency, 0)}
              hint="Relevés de facturation émis"
            />
            <StatCard
              compact
              label="Marge des contrats"
              value={contracts.revenue > 0 ? money(contracts.margin, currency, 0) : '—'}
              hint={
                contracts.revenue > 0
                  ? `${Math.round((contracts.margin / contracts.revenue) * 100)} % du chiffre d’affaires, face au coût des machines sous contrat`
                  : 'Aucun relevé émis sur la fenêtre'
              }
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel>
              <PanelHeader title="Pages par mois" description="Noir et blanc, et couleur" />
              <div className="h-64 px-3 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ left: 4, right: 12, top: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} />
                    <YAxis
                      width={44}
                      tickLine={false}
                      axisLine={false}
                      tick={axisTick}
                      tickFormatter={(value: number) => compact.format(value)}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--muted)' }}
                      contentStyle={tooltipStyle}
                      formatter={(value) => numberFormat.format(Number(value))}
                    />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Bar
                      dataKey="black"
                      name="Noir et blanc"
                      stackId="pages"
                      fill="var(--chart-1)"
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="color"
                      name="Couleur"
                      stackId="pages"
                      fill="var(--chart-3)"
                      radius={[6, 6, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel>
              <PanelHeader
                title="Coût et chiffre d’affaires"
                description={`Par mois, en ${currency}`}
              />
              <div className="h-64 px-3 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ left: 4, right: 12, top: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} />
                    <YAxis
                      width={44}
                      tickLine={false}
                      axisLine={false}
                      tick={axisTick}
                      tickFormatter={(value: number) => compact.format(value)}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--muted)' }}
                      contentStyle={tooltipStyle}
                      formatter={(value) => money(Number(value), currency, 0)}
                    />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Bar
                      dataKey="cost"
                      name="Coût de revient"
                      fill="var(--chart-4)"
                      radius={[6, 6, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="revenue"
                      name="Chiffre d’affaires"
                      fill="var(--chart-2)"
                      radius={[6, 6, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel>
              <PanelHeader
                title="Rentabilité par client"
                description="Relevés émis sur la fenêtre, face au coût de revient des machines du contrat"
              />
              {data.clients.length === 0 ? (
                <EmptyState
                  icon={TrendingUp}
                  title="Aucun relevé émis"
                  description="La rentabilité apparaît dès qu’un relevé de facturation est émis."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">
                        Chiffre d’affaires
                      </TableHead>
                      <TableHead className="hidden text-right sm:table-cell">Coût</TableHead>
                      <TableHead className="text-right">Marge</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.clients.map((client) => (
                      <TableRow key={client.contractId}>
                        <TableCell>
                          <p className="font-medium">{client.customerName}</p>
                          <p className="text-xs text-muted-foreground">{client.reference}</p>
                          <p className="text-xs text-muted-foreground tabular-nums sm:hidden">
                            CA {money(client.revenue, currency, 0)}
                          </p>
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">
                          {money(client.revenue, currency, 0)}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">
                          {money(client.cost, currency, 0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className={client.margin < 0 ? 'text-danger' : undefined}>
                            {money(client.margin, currency, 0)}
                          </span>
                          {client.marginRate !== null && (
                            <p className="text-xs text-muted-foreground">
                              {Math.round(client.marginRate)} %
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>
            <Panel>
              <PanelHeader
                title="Machines les plus actives"
                description="Les cinq machines qui ont le plus imprimé sur la fenêtre"
              />
              {data.topPrinters.length === 0 ? (
                <EmptyState
                  icon={FileBarChart}
                  title="Aucune page"
                  description="Relevez les compteurs pour suivre l’activité des machines."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Machine</TableHead>
                      <TableHead className="text-right">Pages</TableHead>
                      <TableHead className="text-right">Coût / page</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topPrinters.map((printer) => (
                      <TableRow key={printer.id}>
                        <TableCell>
                          <p className="font-medium">{printer.name}</p>
                          <p className="text-xs text-muted-foreground">{printer.siteName}</p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {numberFormat.format(Math.round(printer.pages))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {pageCost(printer.costPerPage, currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>
          </div>
        </>
      )}
    </section>
  );
}

function ReportsView({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const [period, setPeriod] = useState<Period>(lastDays(30));
  const [siteId, setSiteId] = useState('');
  const sites = useQuery({
    queryKey: fleetKeys.sites(tenantId, { all: true }),
    queryFn: () => fleetApi.allSites(tenantId),
  });
  const available = REPORT_TYPES.filter((type) =>
    REPORTS[type].permissions.every((permission) => can(permission)),
  );
  const params = { from: period.from, to: period.to, siteId: siteId || undefined };

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
        <Select
          aria-label="Site"
          className="w-auto min-w-44"
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
      <section className="space-y-4" aria-labelledby="reports-title">
        <div>
          <h2 id="reports-title" className="text-lg font-semibold tracking-[-0.01em]">
            Rapports à télécharger
          </h2>
          <p className="text-[13px] text-muted-foreground">
            PDF à imprimer ou transmettre, Excel à retravailler, CSV pour un autre logiciel. Chaque
            export est inscrit au journal d’audit.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {available.map((type) => (
            <ReportCard key={type} tenantId={tenantId} type={type} params={params} />
          ))}
        </div>
      </section>
      {can('costs:read') && <StatisticsPanel tenantId={tenantId} siteId={siteId} />}
    </>
  );
}

export function ReportsPage() {
  const { tenantId, tenantName } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Rapports et statistiques"
        description={
          tenantName
            ? `Rapports PDF, Excel et CSV, et tendances du parc de ${tenantName}.`
            : 'Rapports PDF, Excel et CSV, et tendances du parc.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? <ReportsView key={tenantId} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
