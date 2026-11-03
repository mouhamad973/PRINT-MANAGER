'use client';

import { DEPENDENCY_NAMES, type DependencyName, type HealthReport } from '@arksen/shared-types';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, ServerOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { fetchHealth, fetchSystemInfo } from './system-api';

const REFRESH_INTERVAL_MS = 15_000;

const DEPENDENCY_LABELS: Record<DependencyName, { name: string; role: string }> = {
  database: { name: 'PostgreSQL', role: 'Données de la plateforme' },
  redis: { name: 'Redis', role: 'Cache et files de tâches' },
  analytics: { name: 'Analytics', role: 'Analyse PDF et moteur CMJN' },
  workers: { name: 'Workers', role: 'Traitements asynchrones' },
};

const OVERALL: Record<HealthReport['status'], { title: string; text: string; color: string }> = {
  ok: {
    title: 'Plateforme opérationnelle',
    text: 'Tous les services répondent.',
    color: 'text-success',
  },
  degraded: {
    title: 'Fonctionnement dégradé',
    text: 'L’API répond, mais un service secondaire est indisponible.',
    color: 'text-warning',
  },
  error: {
    title: 'Plateforme hors service',
    text: 'Une dépendance critique est indisponible.',
    color: 'text-danger',
  },
};

const DEPLOYMENT_LABELS = { cloud: 'Cloud', 'on-premise': 'On-Premise' } as const;

const timeFormat = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'medium' });

function DependencyTable({ report }: { report: HealthReport }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Service</TableHead>
          <TableHead className="hidden sm:table-cell">Rôle</TableHead>
          <TableHead>État</TableHead>
          <TableHead className="text-right">Latence</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {DEPENDENCY_NAMES.map((name) => {
          const dependency = report.dependencies[name];
          const up = dependency.status === 'up';
          return (
            <TableRow key={name}>
              <TableCell>
                <span className="font-medium">{DEPENDENCY_LABELS[name].name}</span>
                {dependency.critical && (
                  <span className="ml-2 text-xs text-muted-foreground">critique</span>
                )}
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {DEPENDENCY_LABELS[name].role}
              </TableCell>
              <TableCell>
                <Badge tone={up ? 'success' : dependency.critical ? 'danger' : 'warning'}>
                  {up ? 'Disponible' : 'Indisponible'}
                </Badge>
                {dependency.message && (
                  <span className="ml-2 text-xs text-muted-foreground">{dependency.message}</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {dependency.latencyMs === null ? '—' : `${dependency.latencyMs} ms`}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3 p-4" role="status" aria-label="Vérification des services en cours">
      {DEPENDENCY_NAMES.map((name) => (
        <Skeleton key={name} className="h-5 w-full" />
      ))}
    </div>
  );
}

function ApiUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 p-6" role="alert">
      <ServerOff className="size-5 text-danger" aria-hidden="true" />
      <div>
        <p className="font-medium">L’API ne répond pas</p>
        <p className="mt-1 text-muted-foreground">
          L’état des services est inconnu. Vérifiez que le conteneur « api » est démarré, puis
          réessayez.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}

export function SystemStatus() {
  const health = useQuery({
    queryKey: ['system', 'health'],
    queryFn: fetchHealth,
    refetchInterval: REFRESH_INTERVAL_MS,
    retry: false,
  });
  const info = useQuery({
    queryKey: ['system', 'info'],
    queryFn: fetchSystemInfo,
    retry: false,
  });

  // Un rapport précédent ne doit jamais masquer une API devenue injoignable.
  const report = health.isError ? undefined : health.data;
  const overall = report && OVERALL[report.status];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-balance">État de la plateforme</h1>
          <p className={cn('mt-1', overall ? overall.color : 'text-muted-foreground')}>
            {overall && <span className="font-medium">{overall.title}. </span>}
            {overall && <span className="text-muted-foreground">{overall.text}</span>}
            {!overall && health.isPending && 'Vérification en cours…'}
            {health.isError && 'État inconnu.'}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={health.isFetching}
          onClick={() => void health.refetch()}
        >
          <RefreshCw className={cn(health.isFetching && 'animate-spin')} aria-hidden="true" />
          Actualiser
        </Button>
      </div>

      <Panel aria-label="Services de la plateforme">
        {report && <DependencyTable report={report} />}
        {!report && health.isPending && <LoadingRows />}
        {health.isError && <ApiUnreachable onRetry={() => void health.refetch()} />}
      </Panel>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:flex sm:flex-wrap">
        <div>
          <dt className="text-xs text-muted-foreground">Mode de déploiement</dt>
          <dd className="mt-0.5 font-medium">
            {info.data ? DEPLOYMENT_LABELS[info.data.deploymentMode] : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Version</dt>
          <dd className="mt-0.5 font-medium tabular-nums">{info.data?.version ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Dernière vérification</dt>
          <dd className="mt-0.5 font-medium tabular-nums">
            {report ? timeFormat.format(new Date(report.checkedAt)) : '—'}
          </dd>
        </div>
      </dl>
    </div>
  );
}
