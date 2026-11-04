'use client';

import { COLOR_MODE_LABELS, COLOR_MODES, type PrinterModel } from '@arksen/shared-types';
import type { PrinterModelCreateInput } from '@arksen/validation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenText, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormError } from '@/components/ui/field';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { SearchInput } from '@/components/ui/search-input';
import { Select } from '@/components/ui/select';
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
import { fleetApi, fleetKeys, send } from './api';
import { ColorModeTag } from './fleet-badges';
import { ModelDialog } from './model-dialog';
import { TenantPicker, useTenantScope } from './tenant-scope';

const PAGE_SIZE = 25;
const numberFormat = new Intl.NumberFormat('fr-FR');

function speed(model: PrinterModel): string {
  const parts = [model.speedMonoPpm, model.speedColorPpm].filter((value) => value !== null);
  return parts.length ? `${parts.join(' / ')} ppm` : '—';
}

/**
 * Fiches techniques. Sans entreprise (compte de plateforme), la page gère le catalogue Arksen ;
 * pour une entreprise, elle montre ce catalogue en lecture et les fiches propres à l'entreprise.
 */
function ModelsList({ tenantId }: { tenantId: string | null }) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const catalogMode = tenantId === null;
  const canManage = catalogMode ? can('platform:catalog:manage') : can('printer-models:manage');
  const [search, setSearch] = useState('');
  const [colorMode, setColorMode] = useState('');
  const [scope, setScope] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PrinterModel | null | 'new'>(null);
  const [deleting, setDeleting] = useState<PrinterModel | null>(null);
  const base = tenantId ? `/tenants/${tenantId}/printer-models` : '/printer-models';
  const params = { search, colorMode, scope: catalogMode ? '' : scope, page };

  const models = useQuery({
    queryKey: fleetKeys.models(tenantId, params),
    queryFn: () => fleetApi.models(tenantId, { ...params, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['fleet'] });
  /** Une entreprise ne modifie que ses propres fiches. */
  const editable = (model: PrinterModel) => canManage && (catalogMode || model.tenantId !== null);

  async function save(values: PrinterModelCreateInput) {
    if (editing && editing !== 'new') {
      await send('PATCH', `${base}/${editing.id}`, values);
    } else {
      await send('POST', base, values);
    }
    await refresh();
    setEditing(null);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">
          <SearchInput
            label="Rechercher une fiche"
            placeholder="Fabricant ou modèle"
            onSearch={onSearch}
          />
          <div className="min-w-36 flex-1 sm:w-44 sm:flex-none">
            <Select
              aria-label="Type d’impression"
              value={colorMode}
              onChange={(event) => {
                setColorMode(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Couleur et N&B</option>
              {COLOR_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {COLOR_MODE_LABELS[mode]}
                </option>
              ))}
            </Select>
          </div>
          {!catalogMode && (
            <div className="min-w-36 flex-1 sm:w-48 sm:flex-none">
              <Select
                aria-label="Origine des fiches"
                value={scope}
                onChange={(event) => {
                  setScope(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">Toutes les fiches</option>
                <option value="catalog">Catalogue Arksen</option>
                <option value="tenant">Fiches de l’entreprise</option>
              </Select>
            </div>
          )}
        </div>
        {canManage && (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            Nouvelle fiche
          </Button>
        )}
      </div>

      <Panel>
        {models.isPending && (
          <div className="space-y-4 p-5" role="status" aria-label="Chargement des fiches">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-6" />
            ))}
          </div>
        )}
        {models.isError && (
          <div className="p-5">
            <FormError message={models.error.message} />
          </div>
        )}
        {models.data?.total === 0 && (
          <EmptyState
            icon={BookOpenText}
            title="Aucune fiche technique"
            description={
              search || colorMode || scope
                ? 'Modifiez la recherche ou les filtres.'
                : catalogMode
                  ? 'Le catalogue Arksen est vide. Ajoutez les modèles que vos clients utilisent : ils les verront tous.'
                  : 'Aucun modèle n’est encore disponible. Créez la fiche du modèle de vos machines.'
            }
            actions={
              canManage &&
              !search && (
                <Button onClick={() => setEditing('new')}>
                  <Plus aria-hidden="true" />
                  Créer une fiche
                </Button>
              )
            }
          />
        )}
        {models.data && models.data.total > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modèle</TableHead>
                  <TableHead>Impression</TableHead>
                  <TableHead className="hidden md:table-cell">Format</TableHead>
                  <TableHead className="hidden lg:table-cell">Vitesse</TableHead>
                  <TableHead className="hidden lg:table-cell">Volume max.</TableHead>
                  {!catalogMode && <TableHead className="hidden sm:table-cell">Origine</TableHead>}
                  <TableHead className="text-right">Machines</TableHead>
                  {canManage && (
                    <TableHead className="text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.data.items.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell>
                      <p className="font-medium">{model.name}</p>
                      <p className="text-xs text-muted-foreground">{model.manufacturer}</p>
                    </TableCell>
                    <TableCell>
                      <ColorModeTag colorMode={model.colorMode} />
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap md:table-cell">
                      {model.maxFormat}
                      {model.duplex && (
                        <span className="ml-1.5 text-xs text-muted-foreground">recto verso</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden tabular-nums whitespace-nowrap lg:table-cell">
                      {speed(model)}
                    </TableCell>
                    <TableCell className="hidden tabular-nums whitespace-nowrap lg:table-cell">
                      {model.monthlyDutyCycle
                        ? `${numberFormat.format(model.monthlyDutyCycle)} p./mois`
                        : '—'}
                    </TableCell>
                    {!catalogMode && (
                      <TableCell className="hidden sm:table-cell">
                        {model.tenantId ? (
                          <Badge>Entreprise</Badge>
                        ) : (
                          <Badge tone="brand">Catalogue Arksen</Badge>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right tabular-nums">{model.printerCount}</TableCell>
                    {canManage && (
                      <TableCell className="text-right whitespace-nowrap">
                        {editable(model) ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Modifier ${model.name}`}
                              title="Modifier"
                              onClick={() => setEditing(model)}
                            >
                              <Pencil aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Supprimer ${model.name}`}
                              title={
                                model.printerCount > 0
                                  ? 'Fiche utilisée par des machines'
                                  : 'Supprimer'
                              }
                              disabled={model.printerCount > 0}
                              onClick={() => setDeleting(model)}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">Lecture seule</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={models.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Panel>

      <ModelDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        model={editing === 'new' ? null : editing}
        scopeLabel={
          catalogMode
            ? 'le catalogue Arksen, visible par toutes les entreprises'
            : 'les fiches de l’entreprise'
        }
        onSubmit={save}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Supprimer ${deleting?.name ?? 'la fiche'} ?`}
        description="La fiche technique sera définitivement supprimée."
        confirmLabel="Supprimer la fiche"
        onConfirm={async () => {
          await send<void>('DELETE', `${base}/${deleting!.id}`);
          await refresh();
        }}
      />
    </>
  );
}

export function ModelsPage() {
  const { tenantId, tenantName, isPlatform } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Fiches techniques"
        description={
          tenantId
            ? `Modèles utilisables par ${tenantName ?? 'l’entreprise'} : le catalogue Arksen et ses propres fiches.`
            : 'Catalogue Arksen : les fiches partagées par toutes les entreprises clientes.'
        }
        actions={isPlatform && <TenantPicker />}
      />
      <ModelsList key={tenantId ?? 'catalog'} tenantId={tenantId} />
    </div>
  );
}
