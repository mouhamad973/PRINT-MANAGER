'use client';

import type { AuditLogEntry, Page } from '@arksen/shared-types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, LoaderCircle } from 'lucide-react';
import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/field';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { lastDays, PeriodPicker, type Period } from '@/features/operations/ops-ui';
import { useSession } from '@/features/session/session-provider';
import { apiDownload, apiFetch, errorMessage, queryString } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const PAGE_SIZE = 50;

export const ACTION_LABELS: Record<string, string> = {
  'auth.sign_in': 'Connexion',
  'auth.sign_in_failed': 'Échec de connexion',
  'auth.sign_in_refused': 'Connexion refusée (compte désactivé)',
  'auth.password_changed': 'Mot de passe modifié',
  'profile.updated': 'Profil modifié',
  'tenant.created': 'Entreprise créée',
  'tenant.updated': 'Entreprise modifiée',
  'tenant.suspended': 'Entreprise suspendue',
  'tenant.reactivated': 'Entreprise réactivée',
  'user.created': 'Utilisateur créé',
  'user.updated': 'Utilisateur modifié',
  'user.password_reset': 'Mot de passe réinitialisé',
  'platform.super_admin_bootstrapped': 'Premier Super Administrateur créé',
  'site.created': 'Site créé',
  'site.updated': 'Site modifié',
  'site.deleted': 'Site supprimé',
  'printer_model.created': 'Fiche technique créée',
  'printer_model.updated': 'Fiche technique modifiée',
  'printer_model.deleted': 'Fiche technique supprimée',
  'printer.created': 'Machine ajoutée',
  'printer.updated': 'Machine modifiée',
  'printer.status_changed': 'Statut de machine modifié',
  'printer.network_updated': 'Configuration réseau modifiée',
  'printer.network_cleared': 'Configuration réseau supprimée',
  'meter.reading_created': 'Relevé de compteurs saisi',
  'meter.reading_deleted': 'Relevé de compteurs supprimé',
  'meter.readings_imported': 'Relevés de compteurs importés',
  'toner.saved': 'Toner renseigné',
  'toner.deleted': 'Toner retiré',
  'toner.price_set': 'Prix de toner modifié',
  'consumption.calibration_updated': 'Paramètres de calcul modifiés',
  'consumption.measurement_created': 'Consommation réelle saisie',
  'consumption.measurement_deleted': 'Consommation réelle supprimée',
  'print_job.analyzed': 'Fichier PDF analysé',
  'print_job.updated': 'Analyse PDF modifiée',
  'print_job.deleted': 'Analyse PDF supprimée',
  'agent.created': 'Agent de collecte déclaré',
  'agent.updated': 'Agent de collecte modifié',
  'agent.code_renewed': 'Code d’enregistrement renouvelé',
  'agent.enrolled': 'Agent de collecte enregistré',
  'agent.revoked': 'Agent de collecte révoqué',
  'discovered_device.updated': 'Équipement découvert associé',
  'stock.created': 'Référence suivie en stock',
  'stock.updated': 'Seuils de stock modifiés',
  'stock.movement_created': 'Mouvement de stock',
  'stock.transferred': 'Transfert de stock',
  'toner.replaced': 'Toner remplacé',
  'toner.replacement_cancelled': 'Remplacement de toner annulé',
  'alert.acknowledged': 'Alerte prise en compte',
  'alert.resolved': 'Alerte clôturée',
  'paper.type_created': 'Papier ajouté',
  'paper.type_updated': 'Papier modifié',
  'paper.stock_created': 'Papier suivi en stock',
  'paper.stock_updated': 'Seuils de papier modifiés',
  'paper.movement_created': 'Mouvement de papier',
  'paper.transferred': 'Transfert de papier',
  'printer.cost_settings_updated': 'Coûts d’une machine réglés',
  'contract.created': 'Contrat créé',
  'contract.updated': 'Contrat modifié',
  'contract.printers_updated': 'Machines d’un contrat modifiées',
  'invoice.drafted': 'Relevé de facturation établi',
  'invoice.issued': 'Relevé de facturation émis',
  'invoice.cancelled': 'Relevé de facturation annulé',
  'invoice.draft_deleted': 'Brouillon de relevé supprimé',
  'intervention.created': 'Intervention ouverte',
  'intervention.updated': 'Intervention modifiée',
  'intervention.scheduled': 'Intervention planifiée',
  'intervention.in_progress': 'Intervention commencée',
  'intervention.done': 'Intervention terminée',
  'intervention.cancelled': 'Intervention annulée',
  'intervention.open': 'Intervention rouverte',
  'maintenance_plan.created': 'Plan de maintenance créé',
  'maintenance_plan.updated': 'Plan de maintenance modifié',
  'print_job.printed': 'Impression enregistrée',
  'print_job.unprinted': 'Impression retirée du registre',
  'report.exported': 'Rapport exporté',
  'audit.exported': 'Journal d’audit exporté',
  'system.retention_applied': 'Politique de conservation appliquée',
};

function describeTarget(entry: AuditLogEntry): string {
  const email = entry.metadata?.email;
  if (typeof email === 'string') return email;
  const name = entry.metadata?.name;
  if (typeof name === 'string') return name;
  return '—';
}

/** Export CSV du journal sur une période, pour un auditeur ou un archivage externe. */
export function AuditExport({ path }: { path: string }) {
  const [period, setPeriod] = useState<Period>(lastDays(30));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportCsv() {
    setPending(true);
    setError(null);
    try {
      await apiDownload(`${path}/export${queryString({ ...period })}`, 'arksen-journal.csv');
    } catch (failure) {
      setError(errorMessage(failure, 'L’export a échoué.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodPicker value={period} onChange={setPeriod} />
        <Button variant="secondary" disabled={pending} onClick={() => void exportCsv()}>
          {pending ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Download aria-hidden="true" />
          )}
          Exporter en CSV
        </Button>
      </div>
      {error && <FormError message={error} />}
    </div>
  );
}

export function AuditPage() {
  const { current, can } = useSession();
  const platform = can('platform:audit:read');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const path = platform ? '/audit-logs' : `/tenants/${current.tenant?.id}/audit-logs`;

  const logs = useQuery({
    queryKey: ['audit', path, { search, page }],
    queryFn: () =>
      apiFetch<Page<AuditLogEntry>>(`${path}${queryString({ search, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal d’audit"
        description={
          platform
            ? 'Toutes les actions sensibles de la plateforme, toutes entreprises confondues. Le journal ne peut pas être modifié, et il est conservé un an au moins.'
            : `Actions sensibles réalisées dans ${current.tenant?.name}. Le journal ne peut pas être modifié, et il est conservé un an au moins.`
        }
      />
      <AuditExport path={path} />
      <SearchInput
        label="Rechercher dans le journal"
        placeholder="Action ou adresse e-mail"
        onSearch={onSearch}
      />
      <Panel>
        {logs.isPending && (
          <div className="space-y-4 p-5" role="status" aria-label="Chargement du journal">
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className="h-6" />
            ))}
          </div>
        )}
        {logs.isError && <FormError message={logs.error.message} />}
        {logs.data && logs.data.total === 0 && (
          <p className="p-6 text-muted-foreground">
            {search
              ? 'Aucun événement ne correspond à la recherche.'
              : 'Aucun événement enregistré.'}
          </p>
        )}
        {logs.data && logs.data.total > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden md:table-cell">Auteur</TableHead>
                  <TableHead className="hidden lg:table-cell">Concerne</TableHead>
                  <TableHead className="hidden lg:table-cell">Adresse IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.data.items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                      <p className="text-xs text-muted-foreground md:hidden">
                        {entry.actorEmail ?? 'Système'}
                      </p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {entry.actorEmail ?? 'Système'}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {describeTarget(entry)}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground tabular-nums lg:table-cell">
                      {entry.ipAddress ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={logs.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Panel>
    </div>
  );
}
