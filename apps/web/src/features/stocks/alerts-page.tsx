'use client';

import { ALERT_STATUS_LABELS, ALERT_TYPE_LABELS, ALERT_TYPES } from '@arksen/shared-types';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, Check, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FormError } from '@/components/ui/field';
import { Pagination } from '@/components/ui/pagination';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { SearchInput } from '@/components/ui/search-input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { ChooseTenant } from '@/features/fleet/choose-tenant';
import { TenantPicker, useTenantScope } from '@/features/fleet/tenant-scope';
import { useSession } from '@/features/session/session-provider';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { stockApi, stockKeys } from './api';
import { AlertSeverityBadge } from './stocks-ui';

const PAGE_SIZE = 20;

function AlertsView({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const { href } = useTenantScope();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('ACTIVE');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const params = { status, type: type || undefined, search, page };
  const alerts = useQuery({
    queryKey: stockKeys.alerts(tenantId, params),
    queryFn: () => stockApi.alerts(tenantId, { ...params, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const summary = useQuery({
    queryKey: stockKeys.alertSummary(tenantId),
    queryFn: () => stockApi.alertSummary(tenantId),
    refetchInterval: 60_000,
  });
  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);
  const manage = can('alerts:manage');

  async function act(alertId: string, action: 'acknowledge' | 'resolve') {
    setError(null);
    try {
      await stockApi.actOnAlert(tenantId, alertId, action);
      await queryClient.invalidateQueries({ queryKey: stockKeys.all(tenantId) });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const byType = summary.data?.byType;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          featured
          label="Alertes actives"
          value={summary.data?.open ?? '—'}
          hint={`${summary.data?.critical ?? 0} critique(s)`}
        />
        <StatCard
          label="Stocks"
          value={byType ? byType.STOCK_OUT + byType.STOCK_LOW : '—'}
          hint={byType ? `${byType.STOCK_OUT} rupture(s), ${byType.STOCK_FORECAST} prévue(s)` : ' '}
        />
        <StatCard
          label="Toners des machines"
          value={byType ? byType.TONER_EMPTY + byType.TONER_LOW : '—'}
          hint={byType ? `${byType.TONER_EMPTY} épuisé(s), d’après l’agent` : ' '}
        />
        <StatCard
          label="Ruptures prévues"
          value={byType?.STOCK_FORECAST ?? '—'}
          hint="Avant le délai de réapprovisionnement"
        />
      </div>

      <Panel>
        <PanelHeader
          title="Alertes"
          description="Ouvertes quand une condition apparaît, résolues d’elles-mêmes quand elle disparaît."
        />
        <div className="flex flex-wrap gap-3 px-5 pb-4">
          <SearchInput
            label="Rechercher une alerte"
            placeholder="Machine, référence…"
            onSearch={onSearch}
          />
          <Select
            aria-label="État"
            className="w-auto min-w-44"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="ACTIVE">Actives</option>
            <option value="OPEN">{ALERT_STATUS_LABELS.OPEN}s</option>
            <option value="ACKNOWLEDGED">{ALERT_STATUS_LABELS.ACKNOWLEDGED}s</option>
            <option value="RESOLVED">{ALERT_STATUS_LABELS.RESOLVED}s</option>
          </Select>
          <Select
            aria-label="Type"
            className="w-auto min-w-52"
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Tous les types</option>
            {ALERT_TYPES.map((item) => (
              <option key={item} value={item}>
                {ALERT_TYPE_LABELS[item]}
              </option>
            ))}
          </Select>
        </div>
        {error && (
          <div className="px-5 pb-4">
            <FormError message={error} />
          </div>
        )}
        {alerts.isPending && <Skeleton className="mx-5 mb-5 h-32" />}
        {alerts.data?.total === 0 && (
          <EmptyState
            icon={BellOff}
            title={status === 'ACTIVE' ? 'Aucune alerte active' : 'Aucune alerte'}
            description="Stocks sous le seuil, ruptures, ruptures prévues et toners épuisés apparaîtront ici."
          />
        )}
        {alerts.data && alerts.data.total > 0 && (
          <>
            <ul className="divide-y divide-border border-t border-border">
              {alerts.data.items.map((alert) => (
                <li
                  key={alert.id}
                  className={cn(
                    'flex flex-wrap items-start justify-between gap-4 px-5 py-4',
                    alert.status === 'RESOLVED' && 'opacity-70',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <AlertSeverityBadge alert={alert} />
                      {alert.status === 'ACKNOWLEDGED' && <Badge>Prise en compte</Badge>}
                      {alert.status === 'RESOLVED' && (
                        <Badge tone="success">
                          {alert.resolution === 'auto' ? 'Résolue d’elle-même' : 'Clôturée'}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-2 font-medium">{alert.title}</p>
                    <p className="text-[13px] text-muted-foreground">{alert.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Depuis le {formatDateTime(alert.openedAt)}
                      {alert.lastSeenAt !== alert.openedAt &&
                        ` · constatée le ${formatDateTime(alert.lastSeenAt)}`}
                      {alert.acknowledgedByEmail &&
                        ` · prise en compte par ${alert.acknowledgedByEmail}`}
                      {alert.resolvedAt && ` · résolue le ${formatDateTime(alert.resolvedAt)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {alert.printer && (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={href(`/machines/${alert.printer.id}`)}>Voir la machine</Link>
                      </Button>
                    )}
                    {alert.stockId && (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={href('/stocks')}>Voir le stock</Link>
                      </Button>
                    )}
                    {manage && alert.status === 'OPEN' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => act(alert.id, 'acknowledge')}
                      >
                        <Check aria-hidden="true" />
                        Prendre en compte
                      </Button>
                    )}
                    {manage && alert.status !== 'RESOLVED' && (
                      <Button variant="ghost" size="sm" onClick={() => act(alert.id, 'resolve')}>
                        <CheckCheck aria-hidden="true" />
                        Clôturer
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={alerts.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Panel>
    </>
  );
}

export function AlertsPage() {
  const { tenantId, tenantName } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Alertes"
        description={
          tenantName
            ? `Ruptures, seuils et toners épuisés de ${tenantName}.`
            : 'Ruptures, seuils et toners épuisés.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? <AlertsView key={tenantId} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
