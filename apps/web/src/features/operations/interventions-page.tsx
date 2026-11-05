'use client';

import {
  INTERVENTION_PRIORITIES,
  INTERVENTION_PRIORITY_LABELS,
  INTERVENTION_STATUSES,
  INTERVENTION_STATUS_LABELS,
  INTERVENTION_TYPES,
  INTERVENTION_TYPE_LABELS,
  type Intervention,
  type InterventionPriority,
  type InterventionStatus,
} from '@arksen/shared-types';
import { interventionCreateSchema, interventionUpdateSchema } from '@arksen/validation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { HardHat, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { SearchInput } from '@/components/ui/search-input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { fleetApi, fleetKeys } from '@/features/fleet/api';
import { ChooseTenant } from '@/features/fleet/choose-tenant';
import { TenantPicker, useTenantScope } from '@/features/fleet/tenant-scope';
import { numberFormat } from '@/features/meters/meters-ui';
import { useSession } from '@/features/session/session-provider';
import { FormDialog, firstIssue } from '@/features/stocks/stock-dialogs';
import { formatDateTime } from '@/lib/format';
import { opsApi, opsKeys } from './api';
import { money } from './ops-ui';

const PAGE_SIZE = 20;

const STATUS_TONES = {
  OPEN: 'warning',
  SCHEDULED: 'brand',
  IN_PROGRESS: 'brand',
  DONE: 'success',
  CANCELLED: 'neutral',
} as const satisfies Record<InterventionStatus, string>;

const PRIORITY_TONES = {
  LOW: 'neutral',
  NORMAL: 'neutral',
  HIGH: 'warning',
  URGENT: 'danger',
} as const satisfies Record<InterventionPriority, string>;

export function InterventionStatusBadge({ status }: { status: InterventionStatus }) {
  return (
    <Badge tone={STATUS_TONES[status]}>
      <StatusDot />
      {INTERVENTION_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Date et heure locales au format d'un champ datetime-local. */
export function localInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
const toIso = (local: string) => (local ? new Date(local).toISOString() : '');

/** Nouvelle intervention : signalement d'une panne, ou planification par un technicien. */
export function NewInterventionDialog({
  tenantId,
  open,
  onClose,
  preset,
}: {
  tenantId: string;
  open: boolean;
  onClose: () => void;
  preset?: { printerId: string; planId?: string; title?: string; type?: string };
}) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const manage = can('interventions:manage');
  const empty = {
    printerId: preset?.printerId ?? '',
    type: preset?.type ?? 'CORRECTIVE',
    priority: 'NORMAL',
    title: preset?.title ?? '',
    description: '',
    scheduledAt: '',
    assigneeId: '',
    planId: preset?.planId ?? '',
  };
  const [values, setValues] = useState<Record<string, string>>(empty);
  const set = (key: string) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const printers = useQuery({
    queryKey: fleetKeys.printers(tenantId, { all: true }),
    queryFn: () => fleetApi.printers(tenantId, { pageSize: 100 }),
    enabled: open,
  });
  const assignees = useQuery({
    queryKey: opsKeys.key(tenantId, 'assignees'),
    queryFn: () => opsApi.assignees(tenantId),
    enabled: open && manage,
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setValues(empty);
          onClose();
        }
      }}
      title={manage ? 'Nouvelle intervention' : 'Signaler une panne'}
      description={manage ? undefined : 'Un technicien prendra la demande en charge.'}
      submitLabel={manage ? 'Créer l’intervention' : 'Signaler'}
      onSubmit={async () => {
        const parsed = interventionCreateSchema.safeParse({
          ...values,
          scheduledAt: toIso(values.scheduledAt ?? ''),
          ...(manage ? {} : { type: 'CORRECTIVE', scheduledAt: '', assigneeId: '', planId: '' }),
        });
        if (!parsed.success) return firstIssue(parsed.error);
        await opsApi.createIntervention(tenantId, parsed.data);
        await queryClient.invalidateQueries({ queryKey: opsKeys.all(tenantId) });
        setValues(empty);
        return null;
      }}
    >
      <Field id="intervention-printer" label="Machine">
        <Select
          id="intervention-printer"
          value={values.printerId}
          onChange={(e) => set('printerId')(e.target.value)}
        >
          <option value="">Choisir une machine…</option>
          {printers.data?.items.map((printer) => (
            <option key={printer.id} value={printer.id}>
              {printer.name} · {printer.site.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="intervention-title" label={manage ? 'Objet' : 'Problème constaté'}>
        <Input
          id="intervention-title"
          placeholder="Bourrage récurrent au bac 2, traînées sur les copies…"
          value={values.title}
          onChange={(e) => set('title')(e.target.value)}
        />
      </Field>
      <Field id="intervention-description" label="Détails">
        <Textarea
          id="intervention-description"
          value={values.description}
          onChange={(e) => set('description')(e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="intervention-priority" label="Priorité">
          <Select
            id="intervention-priority"
            value={values.priority}
            onChange={(e) => set('priority')(e.target.value)}
          >
            {INTERVENTION_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {INTERVENTION_PRIORITY_LABELS[priority]}
              </option>
            ))}
          </Select>
        </Field>
        {manage && (
          <Field id="intervention-type" label="Type">
            <Select
              id="intervention-type"
              value={values.type}
              disabled={Boolean(values.planId)}
              onChange={(e) => set('type')(e.target.value)}
            >
              {INTERVENTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {INTERVENTION_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {manage && (
          <Field
            id="intervention-scheduled"
            label="Prévue le"
            hint="Facultatif : planifie l’intervention"
          >
            <Input
              id="intervention-scheduled"
              type="datetime-local"
              value={values.scheduledAt}
              onChange={(e) => set('scheduledAt')(e.target.value)}
            />
          </Field>
        )}
        {manage && (
          <Field id="intervention-assignee" label="Confiée à">
            <Select
              id="intervention-assignee"
              value={values.assigneeId}
              onChange={(e) => set('assigneeId')(e.target.value)}
            >
              <option value="">Personne pour l’instant</option>
              {assignees.data?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </FormDialog>
  );
}

/** Suivi d'une intervention : statut, affectation, puis clôture avec ses coûts. */
function InterventionDialog({
  tenantId,
  intervention,
  onClose,
}: {
  tenantId: string;
  intervention: Intervention | null;
  onClose: () => void;
}) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const manage = can('interventions:manage');
  const closed = intervention?.status === 'DONE' || intervention?.status === 'CANCELLED';
  const initial = {
    status: intervention?.status ?? 'OPEN',
    assigneeId: intervention?.assignee?.id ?? '',
    scheduledAt: localInput(intervention?.scheduledAt ?? null),
    completedAt: '',
    laborMinutes: intervention?.laborMinutes?.toString() ?? '',
    laborCost: intervention?.laborCost?.toString() ?? '',
    partsCost: intervention?.partsCost?.toString() ?? '',
    resolution: intervention?.resolution ?? '',
  };
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const current = values ?? initial;
  const set = (key: string) => (value: string) => setValues({ ...current, [key]: value });
  const assignees = useQuery({
    queryKey: opsKeys.key(tenantId, 'assignees'),
    queryFn: () => opsApi.assignees(tenantId),
    enabled: intervention !== null && manage,
  });
  if (!intervention) return null;
  const done = current.status === 'DONE';

  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          setValues(null);
          onClose();
        }
      }}
      title={`#${intervention.number} · ${intervention.title}`}
      description={`${intervention.printer.name} (${intervention.printer.siteName}) · ${INTERVENTION_TYPE_LABELS[intervention.type]} · signalée le ${formatDateTime(intervention.reportedAt)}${intervention.reportedByEmail ? ` par ${intervention.reportedByEmail}` : ''}`}
      submitLabel={closed || !manage ? 'Fermer' : 'Enregistrer'}
      onSubmit={async () => {
        if (closed || !manage) return null;
        const parsed = interventionUpdateSchema.safeParse({
          status: current.status,
          assigneeId: current.assigneeId,
          scheduledAt: toIso(current.scheduledAt ?? ''),
          ...(done
            ? {
                completedAt: toIso(current.completedAt ?? ''),
                laborMinutes: current.laborMinutes,
                laborCost: current.laborCost,
                partsCost: current.partsCost,
                resolution: current.resolution,
              }
            : {}),
        });
        if (!parsed.success) return firstIssue(parsed.error);
        await opsApi.updateIntervention(tenantId, intervention.id, parsed.data);
        await queryClient.invalidateQueries({ queryKey: opsKeys.all(tenantId) });
        setValues(null);
        return null;
      }}
    >
      {intervention.description && (
        <p className="rounded-lg bg-surface-raised px-3.5 py-3 text-[13px] whitespace-pre-line">
          {intervention.description}
        </p>
      )}
      {closed || !manage ? (
        <dl className="grid grid-cols-2 gap-4 text-[13px]">
          <div>
            <dt className="text-xs text-muted-foreground">Statut</dt>
            <dd className="mt-1">
              <InterventionStatusBadge status={intervention.status} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Confiée à</dt>
            <dd className="mt-1">{intervention.assignee?.name ?? '—'}</dd>
          </div>
          {intervention.completedAt && (
            <div>
              <dt className="text-xs text-muted-foreground">Terminée le</dt>
              <dd className="mt-1">{formatDateTime(intervention.completedAt)}</dd>
            </div>
          )}
          {intervention.totalCost !== null && (
            <div>
              <dt className="text-xs text-muted-foreground">Coût</dt>
              <dd className="mt-1">{money(intervention.totalCost, intervention.currency)}</dd>
            </div>
          )}
          {intervention.resolution && (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Ce qui a été fait</dt>
              <dd className="mt-1 whitespace-pre-line">{intervention.resolution}</dd>
            </div>
          )}
        </dl>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="update-status" label="Statut">
              <Select
                id="update-status"
                value={current.status}
                onChange={(e) => set('status')(e.target.value)}
              >
                {INTERVENTION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {INTERVENTION_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="update-assignee" label="Confiée à">
              <Select
                id="update-assignee"
                value={current.assigneeId}
                onChange={(e) => set('assigneeId')(e.target.value)}
              >
                <option value="">Personne</option>
                {assignees.data?.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="update-scheduled" label="Prévue le">
              <Input
                id="update-scheduled"
                type="datetime-local"
                value={current.scheduledAt}
                onChange={(e) => set('scheduledAt')(e.target.value)}
              />
            </Field>
            {done && (
              <Field id="update-completed" label="Terminée le" hint="Vide : maintenant">
                <Input
                  id="update-completed"
                  type="datetime-local"
                  value={current.completedAt}
                  onChange={(e) => set('completedAt')(e.target.value)}
                />
              </Field>
            )}
          </div>
          {done && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="update-minutes" label="Durée" hint="Minutes">
                  <Input
                    id="update-minutes"
                    inputMode="numeric"
                    value={current.laborMinutes}
                    onChange={(e) => set('laborMinutes')(e.target.value)}
                  />
                </Field>
                <Field id="update-labor" label="Main-d’œuvre" hint={intervention.currency}>
                  <Input
                    id="update-labor"
                    inputMode="decimal"
                    value={current.laborCost}
                    onChange={(e) => set('laborCost')(e.target.value)}
                  />
                </Field>
                <Field id="update-parts" label="Pièces" hint={intervention.currency}>
                  <Input
                    id="update-parts"
                    inputMode="decimal"
                    value={current.partsCost}
                    onChange={(e) => set('partsCost')(e.target.value)}
                  />
                </Field>
              </div>
              <Field id="update-resolution" label="Ce qui a été fait">
                <Textarea
                  id="update-resolution"
                  value={current.resolution}
                  onChange={(e) => set('resolution')(e.target.value)}
                />
              </Field>
            </>
          )}
        </>
      )}
    </FormDialog>
  );
}

function InterventionsView({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const [status, setStatus] = useState('ACTIVE');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Intervention | null>(null);
  const params = { status, type: type || undefined, search, page };
  const list = useQuery({
    queryKey: opsKeys.key(tenantId, 'interventions', params),
    queryFn: () => opsApi.interventions(tenantId, { ...params, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  return (
    <Panel>
      <PanelHeader
        title="Interventions"
        description="Pannes signalées, maintenances et installations, des plus urgentes aux plus anciennes"
        actions={
          can('interventions:report') && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              {can('interventions:manage') ? 'Nouvelle intervention' : 'Signaler une panne'}
            </Button>
          )
        }
      />
      <div className="flex flex-wrap gap-3 px-5 pb-4">
        <SearchInput
          label="Rechercher une intervention"
          placeholder="Numéro, machine, objet"
          onSearch={onSearch}
        />
        <Select
          aria-label="Statut"
          className="w-auto min-w-44"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="ACTIVE">En cours de traitement</option>
          {INTERVENTION_STATUSES.map((item) => (
            <option key={item} value={item}>
              {INTERVENTION_STATUS_LABELS[item]}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Type"
          className="w-auto min-w-48"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Tous les types</option>
          {INTERVENTION_TYPES.map((item) => (
            <option key={item} value={item}>
              {INTERVENTION_TYPE_LABELS[item]}
            </option>
          ))}
        </Select>
      </div>
      {list.isPending && <Skeleton className="mx-5 mb-5 h-32" />}
      {list.data?.total === 0 && (
        <EmptyState
          icon={HardHat}
          title={status === 'ACTIVE' ? 'Aucune intervention en cours' : 'Aucune intervention'}
          description="Les pannes signalées et les maintenances planifiées apparaîtront ici."
        />
      )}
      {list.data && list.data.total > 0 && (
        <>
          <ul className="divide-y divide-border border-t border-border">
            {list.data.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer flex-wrap items-start justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/50"
                  onClick={() => setSelected(item)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <InterventionStatusBadge status={item.status} />
                      {item.priority !== 'NORMAL' && (
                        <Badge tone={PRIORITY_TONES[item.priority]}>
                          Priorité {INTERVENTION_PRIORITY_LABELS[item.priority].toLowerCase()}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {INTERVENTION_TYPE_LABELS[item.type]}
                      </span>
                    </div>
                    <p className="mt-1.5 font-medium">
                      <span className="text-muted-foreground tabular-nums">#{item.number}</span>{' '}
                      {item.title}
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      {item.printer.name} · {item.printer.siteName}
                      {item.assignee && ` · ${item.assignee.name}`}
                    </p>
                  </div>
                  <div className="w-full text-xs text-muted-foreground sm:w-auto sm:text-right">
                    {item.scheduledAt && item.status === 'SCHEDULED' ? (
                      <p className="font-medium text-foreground">
                        Prévue le {formatDateTime(item.scheduledAt)}
                      </p>
                    ) : item.completedAt ? (
                      <p>Terminée le {formatDateTime(item.completedAt)}</p>
                    ) : (
                      <p>Signalée le {formatDateTime(item.reportedAt)}</p>
                    )}
                    {item.totalCost !== null && <p>{money(item.totalCost, item.currency)}</p>}
                    {item.counter !== null && <p>Compteur {numberFormat.format(item.counter)}</p>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={list.data.total}
            onPageChange={setPage}
          />
        </>
      )}
      <NewInterventionDialog
        tenantId={tenantId}
        open={creating}
        onClose={() => setCreating(false)}
      />
      <InterventionDialog
        key={selected?.id ?? 'none'}
        tenantId={tenantId}
        intervention={selected}
        onClose={() => setSelected(null)}
      />
    </Panel>
  );
}

export function InterventionsPage() {
  const { tenantId, tenantName } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Interventions"
        description={
          tenantName
            ? `Interventions techniques sur le parc de ${tenantName}.`
            : 'Interventions techniques sur le parc.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? <InterventionsView key={tenantId} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
