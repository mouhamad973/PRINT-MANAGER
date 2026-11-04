'use client';

import type { AuditLogEntry, Page } from '@arksen/shared-types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
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
import { useSession } from '@/features/session/session-provider';
import { apiFetch, queryString } from '@/lib/api';
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
};

function describeTarget(entry: AuditLogEntry): string {
  const email = entry.metadata?.email;
  if (typeof email === 'string') return email;
  const name = entry.metadata?.name;
  if (typeof name === 'string') return name;
  return '—';
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
            ? 'Toutes les actions sensibles de la plateforme, toutes entreprises confondues. Le journal ne peut être ni modifié ni effacé.'
            : `Actions sensibles réalisées dans ${current.tenant?.name}. Le journal ne peut être ni modifié ni effacé.`
        }
      />
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
