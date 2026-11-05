'use client';

import {
  RETENTION_TARGET_LABELS,
  RETENTION_TARGETS,
  type RetentionRun,
  type RetentionStatus,
} from '@arksen/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eraser } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormError } from '@/components/ui/field';
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
import { AuditExport } from '@/features/audit/audit-page';
import { numberFormat } from '@/features/meters/meters-ui';
import { apiFetch, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { fetchHealth, fetchSystemInfo } from './system-api';

const RETENTION_KEY = ['system', 'retention'] as const;
const DEPLOYMENT_LABELS = { cloud: 'Cloud', 'on-premise': 'On-Premise' } as const;
const HEALTH_LABELS = {
  ok: 'Opérationnelle',
  degraded: 'Fonctionnement dégradé',
  error: 'Hors service',
} as const;

/** Durée lisible : « 3 ans », « 6 mois », « 45 jours ». */
export function durationLabel(days: number): string {
  if (days % 365 === 0) return `${days / 365} an${days === 365 ? '' : 's'}`;
  if (days % 30 === 0) return `${days / 30} mois`;
  return `${days} jours`;
}

function RetentionPanel() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const status = useQuery({
    queryKey: RETENTION_KEY,
    queryFn: () => apiFetch<RetentionStatus>('/system/retention'),
  });
  const lastRun = status.data?.lastRun ?? null;

  return (
    <Panel>
      <PanelHeader
        title="Conservation des données"
        description="Purge quotidienne des traces techniques. Les compteurs, les registres de stock et de papier, les relevés de facturation et les interventions ne sont jamais purgés."
        actions={
          <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
            <Eraser aria-hidden="true" />
            Appliquer maintenant
          </Button>
        }
      />
      {status.isPending && <Skeleton className="mx-5 mb-5 h-40" />}
      {status.isError && (
        <div className="px-5 pb-5">
          <FormError message={errorMessage(status.error, 'Politique indisponible.')} />
        </div>
      )}
      {status.data && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Donnée</TableHead>
                <TableHead>Conservée</TableHead>
                <TableHead className="text-right">Dernière purge</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {RETENTION_TARGETS.map((target) => (
                <TableRow key={target}>
                  <TableCell className="font-medium">{RETENTION_TARGET_LABELS[target]}</TableCell>
                  <TableCell className="tabular-nums">
                    {durationLabel(status.data.policy[target])}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {lastRun
                      ? `${numberFormat.format(lastRun.purged[target])} ligne${lastRun.purged[target] > 1 ? 's' : ''}`
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="px-5 py-4 text-[13px] text-muted-foreground">
            {lastRun
              ? `Dernière exécution le ${formatDateTime(lastRun.finishedAt)} (${lastRun.trigger === 'manual' ? 'lancée à la main' : 'purge quotidienne'}).`
              : 'Aucune purge depuis le démarrage du cache Redis.'}{' '}
            Les durées se règlent par les variables RETENTION_* ; le journal d’audit est conservé un
            an au moins, plancher imposé aussi par la base de données.
          </p>
        </>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Appliquer la politique de conservation ?"
        description="Les données plus anciennes que leur durée de conservation sont supprimées définitivement. L’opération est inscrite au journal d’audit."
        confirmLabel="Purger"
        onConfirm={async () => {
          const run = await apiFetch<RetentionRun>('/system/retention/run', { method: 'POST' });
          queryClient.setQueryData<RetentionStatus>(RETENTION_KEY, (previous) =>
            previous ? { ...previous, lastRun: run } : previous,
          );
          setConfirming(false);
        }}
      />
    </Panel>
  );
}

export function AdministrationPage() {
  const info = useQuery({ queryKey: ['system', 'info'], queryFn: fetchSystemInfo });
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Administration système"
        description="Version installée, conservation des données et archivage du journal d’audit de la plateforme."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          compact
          label="Version"
          value={info.data?.version ?? '…'}
          hint={info.data?.name ?? 'ARKSEN PRINT MANAGER'}
        />
        <StatCard
          compact
          label="Déploiement"
          value={info.data ? DEPLOYMENT_LABELS[info.data.deploymentMode] : '…'}
          hint={
            info.data?.deploymentMode === 'on-premise'
              ? 'Serveur de l’entreprise'
              : 'Hébergé par Arksen'
          }
        />
        <StatCard
          compact
          label="État de la plateforme"
          value={health.data ? HEALTH_LABELS[health.data.status] : '…'}
          hint="Détail des services"
          href="/"
        />
      </div>
      <RetentionPanel />
      <Panel>
        <PanelHeader
          title="Archivage du journal d’audit"
          description="Export CSV de toute la plateforme sur une période, à conserver hors de l’application avant la fin de la durée de conservation."
        />
        <div className="px-5 pb-5">
          <AuditExport path="/audit-logs" />
        </div>
      </Panel>
    </div>
  );
}
