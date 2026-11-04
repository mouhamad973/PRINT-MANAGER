'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { InkLabel } from '@/features/consumption/consumption-ui';
import { useTenantScope } from '@/features/fleet/tenant-scope';
import { useSession } from '@/features/session/session-provider';
import { stockApi, stockKeys } from './api';
import { AlertSeverityBadge, StockLevelBadge } from './stocks-ui';

/** Tableau de bord : alertes actives et stocks critiques. Rien n'est affiché s'il n'y a rien. */
export function AlertsOverview({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const { href } = useTenantScope();
  const summary = useQuery({
    queryKey: stockKeys.alertSummary(tenantId),
    queryFn: () => stockApi.alertSummary(tenantId),
    refetchInterval: 60_000,
  });
  const alerts = useQuery({
    queryKey: stockKeys.alerts(tenantId, { status: 'ACTIVE', page: 1, preview: true }),
    queryFn: () => stockApi.alerts(tenantId, { status: 'ACTIVE', pageSize: 5 }),
    refetchInterval: 60_000,
  });
  const data = summary.data;
  if (!data || (data.open === 0 && data.criticalStocks.length === 0)) return null;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel>
        <PanelHeader
          title="Alertes"
          description={`${data.open} active(s), dont ${data.critical} critique(s)`}
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link href={href('/alertes')}>
                Toutes les alertes
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          }
        />
        {data.open === 0 ? (
          <p className="px-5 pb-6 text-[13px] text-muted-foreground">Aucune alerte active.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {alerts.data?.items.map((alert) => (
              <li key={alert.id} className="space-y-1.5 px-5 py-3">
                <AlertSeverityBadge alert={alert} />
                <p className="text-[13px] font-medium">{alert.title}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel>
        <PanelHeader
          title="Stocks critiques"
          description="Articles sous leur seuil ou en rupture"
          actions={
            can('stocks:read') && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={href('/stocks')}>
                  Stocks
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            )
          }
        />
        {data.criticalStocks.length === 0 ? (
          <p className="px-5 pb-6 text-[13px] text-muted-foreground">
            Tous les stocks suivis sont au-dessus de leur seuil.
          </p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {data.criticalStocks.map((stock) => (
              <li key={stock.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">
                    {stock.reference} · {stock.siteName}
                  </p>
                  <InkLabel channel={stock.channel} className="text-xs text-muted-foreground" />
                </div>
                <div className="flex items-center gap-3 text-right">
                  <span className="text-[13px] tabular-nums">
                    <span className="font-semibold">{stock.quantity}</span>
                    <span className="text-muted-foreground"> / seuil {stock.minQuantity}</span>
                  </span>
                  <StockLevelBadge level={stock.level} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
