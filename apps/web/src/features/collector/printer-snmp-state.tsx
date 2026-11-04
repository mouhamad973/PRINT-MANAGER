'use client';

import {
  DEVICE_STATUS_LABELS,
  PRINTER_ACTIVITY_LABELS,
  PRINTER_ALERT_LABELS,
  type SupplyForecast,
  type SupplyLevel,
} from '@arksen/shared-types';
import { useQuery } from '@tanstack/react-query';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { INK_CLASSES } from '@/features/consumption/consumption-ui';
import { numberFormat } from '@/features/meters/meters-ui';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { collectorApi, collectorKeys } from './api';

const percent = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** Alertes qui empêchent d'imprimer : en rouge ; les autres en orange. */
const BLOCKING = new Set(['noPaper', 'noToner', 'doorOpen', 'jammed', 'offline', 'outputFull']);

function SupplyRow({ supply, forecast }: { supply: SupplyLevel; forecast?: SupplyForecast }) {
  const level = supply.levelPercent;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_7rem_3.5rem] items-center gap-3 py-2 text-[13px]">
      <span className="min-w-0">
        <span className="block truncate" title={supply.description}>
          {supply.description}
        </span>
        {forecast?.emptyAt && (
          <span
            className="block text-xs text-muted-foreground"
            title={`Tendance des niveaux depuis le dernier remplacement : ${percent.format(forecast.percentPerDay ?? 0)} point(s) par jour`}
          >
            Épuisement prévu vers le {formatDate(forecast.emptyAt)}
          </span>
        )}
      </span>
      <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {level !== null && (
          <span
            className={cn(
              'block h-full rounded-full',
              supply.channel ? INK_CLASSES[supply.channel] : 'bg-muted-foreground/50',
            )}
            style={{ width: `${Math.max(level, 2)}%` }}
          />
        )}
      </span>
      <span
        className={cn(
          'text-right tabular-nums',
          level !== null && level <= 10 ? 'font-medium text-danger' : 'text-muted-foreground',
        )}
      >
        {level === null ? 'Inconnu' : `${percent.format(level)} %`}
      </span>
    </li>
  );
}

/**
 * Dernier état collecté par l'agent. Les niveaux sont ceux que déclare la machine (origine
 * « niveau SNMP ») : ils ne sont ni une consommation mesurée ni un calcul.
 */
export function PrinterSnmpState({ tenantId, printerId }: { tenantId: string; printerId: string }) {
  const query = useQuery({
    queryKey: collectorKeys.state(tenantId, printerId),
    queryFn: () => collectorApi.state(tenantId, printerId),
    refetchInterval: 60_000,
  });
  const state = query.data?.state;

  return (
    <Panel aria-labelledby="snmp-state-title">
      <PanelHeader
        title={<span id="snmp-state-title">État SNMP</span>}
        description={
          state
            ? `Collecté le ${formatDateTime(state.observedAt)} par ${state.agent.name}`
            : 'Collecté par un agent ARKSEN Collector'
        }
        actions={
          state &&
          (state.reachable ? (
            <Badge tone="success">
              <StatusDot />
              Joignable
            </Badge>
          ) : (
            <Badge tone="danger">
              <StatusDot />
              Injoignable
            </Badge>
          ))
        }
      />
      {query.isPending && <Skeleton className="mx-5 mb-5 h-28" />}
      {query.data && !state && (
        <p className="px-5 pb-6 text-[13px] text-muted-foreground">
          Aucune collecte : renseignez l’adresse de la machine ci-dessous et installez un agent de
          collecte sur son réseau.
        </p>
      )}
      {state && !state.reachable && (
        <p className="mx-5 mb-5 rounded-md border border-danger/25 bg-danger/5 px-3.5 py-2.5 text-[13px] text-danger">
          {state.error}
        </p>
      )}
      {state?.reachable && (
        <div className="grid gap-6 px-5 pb-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <dl className="grid content-start gap-4 text-[13px]">
            <div>
              <dt className="text-xs text-muted-foreground">Statut</dt>
              <dd className="mt-1 font-medium">
                {state.deviceStatus ? DEVICE_STATUS_LABELS[state.deviceStatus] : '—'}
                {state.printerStatus && (
                  <span className="font-normal text-muted-foreground">
                    {' · '}
                    {PRINTER_ACTIVITY_LABELS[state.printerStatus]}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Alertes</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {state.alerts.length === 0 && <span className="text-muted-foreground">Aucune</span>}
                {state.alerts.map((alert) => (
                  <Badge key={alert} tone={BLOCKING.has(alert) ? 'danger' : 'warning'}>
                    <StatusDot />
                    {PRINTER_ALERT_LABELS[alert]}
                  </Badge>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Compteur total de la machine</dt>
              <dd className="mt-1 font-medium tabular-nums">
                {state.totalCount === null ? '—' : numberFormat.format(state.totalCount)}
              </dd>
            </div>
            {state.description && (
              <div>
                <dt className="text-xs text-muted-foreground">Équipement</dt>
                <dd className="mt-1">{state.description}</dd>
              </div>
            )}
          </dl>
          <div>
            <p className="text-xs text-muted-foreground">
              Consommables, niveau déclaré par la machine
            </p>
            {state.supplies.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted-foreground">
                La machine ne publie pas ses consommables.
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-border">
                {state.supplies.map((supply) => (
                  <SupplyRow
                    key={supply.index}
                    supply={supply}
                    // La prévision suit la première cartouche de chaque canal, comme l'historique.
                    forecast={
                      supply.channel &&
                      state.supplies.find((item) => item.channel === supply.channel) === supply
                        ? state.forecasts.find((item) => item.channel === supply.channel)
                        : undefined
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
