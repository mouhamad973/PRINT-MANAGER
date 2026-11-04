'use client';

import { DEPENDENCY_NAMES, type DependencyName, type HealthReport } from '@arksen/shared-types';
import { useQuery } from '@tanstack/react-query';
import { Cloud, RefreshCw, ServerOff, Tag, Timer, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel, PanelHeader } from '@/components/ui/panel';
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
                  <StatusDot />
                  {up ? 'Disponible' : 'Indisponible'}
                </Badge>
                {dependency.message && (
                  <span className="ml-2 text-xs text-muted-foreground">{dependency.message}</span>
                )}
              </TableCell>
              <TableCell className="text-right font-medium">
                {dependency.latencyMs === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  `${dependency.latencyMs} ms`
                )}
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
    <div
      className="space-y-4 px-5 pb-5"
      role="status"
      aria-label="Vérification des services en cours"
    >
      {DEPENDENCY_NAMES.map((name) => (
        <Skeleton key={name} className="h-6 w-full" />
      ))}
    </div>
  );
}

function ApiUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 px-5 pb-6" role="alert">
      <span className="flex size-10 items-center justify-center rounded-full bg-danger/10 text-danger">
        <ServerOff className="size-5" aria-hidden="true" />
      </span>
      <div>
        <p className="font-semibold">L’API ne répond pas</p>
        <p className="mt-1 max-w-[60ch] text-muted-foreground">
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

/** Latence mesurée d'un service, ou rien tant qu'elle est inconnue. */
function latencyOf(report: HealthReport | undefined, name: DependencyName) {
  const value = report?.dependencies[name].latencyMs;
  return value === null || value === undefined
    ? { value: '—' }
    : { value: String(value), unit: 'ms' };
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-3.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <dt className="flex-1 text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
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
  const upCount = report
    ? DEPENDENCY_NAMES.filter((name) => report.dependencies[name].status === 'up').length
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="État de la plateforme"
        description={
          <p className={cn(overall?.color)}>
            {overall && <span className="font-medium">{overall.title}. </span>}
            {overall && <span className="text-muted-foreground">{overall.text}</span>}
            {!overall && health.isPending && 'Vérification en cours…'}
            {health.isError && 'État inconnu.'}
          </p>
        }
        actions={
          <Button
            variant="secondary"
            disabled={health.isFetching}
            onClick={() => void health.refetch()}
          >
            <RefreshCw className={cn(health.isFetching && 'animate-spin')} aria-hidden="true" />
            Actualiser
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          featured
          className="col-span-2 sm:col-span-1"
          label="Services disponibles"
          value={upCount === null ? '—' : `${upCount}/${DEPENDENCY_NAMES.length}`}
          hint={
            report ? (
              <>
                <StatusDot />
                Vérifiés à {timeFormat.format(new Date(report.checkedAt))}
              </>
            ) : (
              'Aucun rapport reçu'
            )
          }
        />
        <StatCard
          label="Base de données"
          {...latencyOf(report, 'database')}
          hint="Temps de réponse de PostgreSQL"
        />
        <StatCard
          label="Cache et files"
          {...latencyOf(report, 'redis')}
          hint="Temps de réponse de Redis"
        />
        <StatCard
          label="Moteur d’analyse"
          {...latencyOf(report, 'analytics')}
          hint="Temps de réponse du service CMJN"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel aria-label="Services de la plateforme" className="xl:col-span-2">
          <PanelHeader
            title="Services"
            description={`Actualisés toutes les ${REFRESH_INTERVAL_MS / 1000} secondes`}
          />
          {report && <DependencyTable report={report} />}
          {!report && health.isPending && <LoadingRows />}
          {health.isError && <ApiUnreachable onRetry={() => void health.refetch()} />}
        </Panel>

        <Panel aria-label="Déploiement">
          <PanelHeader title="Déploiement" description="Instance qui sert cette page" />
          <dl className="divide-y divide-border/80 px-5 pb-2">
            <InfoRow
              icon={Cloud}
              label="Mode"
              value={info.data ? DEPLOYMENT_LABELS[info.data.deploymentMode] : '—'}
            />
            <InfoRow icon={Tag} label="Version" value={info.data?.version ?? '—'} />
            <InfoRow
              icon={Timer}
              label="Dernière vérification"
              value={report ? timeFormat.format(new Date(report.checkedAt)) : '—'}
            />
          </dl>
        </Panel>
      </div>
    </div>
  );
}
