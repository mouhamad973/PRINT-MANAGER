'use client';

import {
  MAINTENANCE_STATE_LABELS,
  type MaintenancePlan,
  type MaintenanceState,
} from '@arksen/shared-types';
import { maintenancePlanCreateSchema, maintenancePlanUpdateSchema } from '@arksen/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Pencil, Plus, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { fleetApi, fleetKeys } from '@/features/fleet/api';
import { ChooseTenant } from '@/features/fleet/choose-tenant';
import { TenantPicker, useTenantScope } from '@/features/fleet/tenant-scope';
import { numberFormat } from '@/features/meters/meters-ui';
import { useSession } from '@/features/session/session-provider';
import { FormDialog, firstIssue } from '@/features/stocks/stock-dialogs';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { opsApi, opsKeys } from './api';
import { InterventionStatusBadge, NewInterventionDialog } from './interventions-page';

const STATE_TONES = {
  OK: 'success',
  DUE_SOON: 'warning',
  OVERDUE: 'danger',
  UNKNOWN: 'neutral',
} as const satisfies Record<MaintenanceState, string>;

const BAR_TONES: Record<MaintenanceState, string> = {
  OK: 'bg-primary',
  DUE_SOON: 'bg-warning',
  OVERDUE: 'bg-danger',
  UNKNOWN: 'bg-muted-foreground/40',
};

function PlanDialog({
  tenantId,
  plan,
  open,
  onClose,
}: {
  tenantId: string;
  plan: MaintenancePlan | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const initial = {
    printerId: plan?.printer.id ?? '',
    name: plan?.name ?? 'Révision',
    intervalPages: plan?.intervalPages?.toString() ?? '',
    intervalDays: plan?.intervalDays?.toString() ?? '',
    notes: plan?.notes ?? '',
    active: plan ? String(plan.active) : 'true',
  };
  const [values, setValues] = useState<Record<string, string>>(initial);
  const set = (key: string) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const printers = useQuery({
    queryKey: fleetKeys.printers(tenantId, { all: true }),
    queryFn: () => fleetApi.printers(tenantId, { pageSize: 100 }),
    enabled: open && !plan,
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={plan ? `${plan.name} · ${plan.printer.name}` : 'Nouveau plan de maintenance'}
      description="Une révision tous les N pages, tous les N jours, ou au premier des deux termes."
      submitLabel={plan ? 'Enregistrer' : 'Créer le plan'}
      onSubmit={async () => {
        const common = {
          name: values.name,
          intervalPages: values.intervalPages,
          intervalDays: values.intervalDays,
          notes: values.notes,
          active: values.active === 'true',
        };
        if (plan) {
          const parsed = maintenancePlanUpdateSchema.safeParse(common);
          if (!parsed.success) return firstIssue(parsed.error);
          await opsApi.updatePlan(tenantId, plan.id, parsed.data);
        } else {
          const parsed = maintenancePlanCreateSchema.safeParse({
            ...common,
            printerId: values.printerId,
          });
          if (!parsed.success) return firstIssue(parsed.error);
          await opsApi.createPlan(tenantId, parsed.data);
        }
        await queryClient.invalidateQueries({ queryKey: opsKeys.all(tenantId) });
        return null;
      }}
    >
      {!plan && (
        <Field id="plan-printer" label="Machine">
          <Select
            id="plan-printer"
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
      )}
      <Field id="plan-name" label="Nom">
        <Input id="plan-name" value={values.name} onChange={(e) => set('name')(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="plan-pages" label="Toutes les" hint="Pages imprimées">
          <Input
            id="plan-pages"
            inputMode="numeric"
            placeholder="100 000"
            value={values.intervalPages}
            onChange={(e) => set('intervalPages')(e.target.value)}
          />
        </Field>
        <Field id="plan-days" label="Ou tous les" hint="Jours">
          <Input
            id="plan-days"
            inputMode="numeric"
            placeholder="180"
            value={values.intervalDays}
            onChange={(e) => set('intervalDays')(e.target.value)}
          />
        </Field>
      </div>
      {plan && (
        <Field id="plan-active" label="État du plan">
          <Select
            id="plan-active"
            value={values.active}
            onChange={(e) => set('active')(e.target.value)}
          >
            <option value="true">Actif</option>
            <option value="false">Suspendu : aucune alerte</option>
          </Select>
        </Field>
      )}
      <Field id="plan-notes" label="Opérations prévues">
        <Textarea
          id="plan-notes"
          value={values.notes}
          onChange={(e) => set('notes')(e.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

function MaintenanceView({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const { href } = useTenantScope();
  const manage = can('interventions:manage');
  const [editing, setEditing] = useState<{ plan: MaintenancePlan | null } | null>(null);
  const [planning, setPlanning] = useState<MaintenancePlan | null>(null);
  const plans = useQuery({
    queryKey: opsKeys.key(tenantId, 'plans'),
    queryFn: () => opsApi.plans(tenantId),
  });

  return (
    <Panel>
      <PanelHeader
        title="Plans de maintenance préventive"
        description="Échéance en pages (au rythme d’impression des 90 derniers jours) ou en jours ; alerte à 90 % de l’intervalle"
        actions={
          manage && (
            <Button onClick={() => setEditing({ plan: null })}>
              <Plus aria-hidden="true" />
              Nouveau plan
            </Button>
          )
        }
      />
      {plans.isPending && <Skeleton className="mx-5 mb-5 h-32" />}
      {plans.data?.length === 0 && (
        <EmptyState
          icon={Wrench}
          title="Aucun plan de maintenance"
          description="Fixez pour chaque machine une révision tous les N pages ou tous les N jours : l’échéance est suivie et signalée."
        />
      )}
      {plans.data && plans.data.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {plans.data.map((plan) => (
            <li
              key={plan.id}
              className={cn(
                'grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_16rem_auto] lg:items-center',
                !plan.active && 'opacity-60',
              )}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={plan.active ? STATE_TONES[plan.state] : 'neutral'}>
                    <StatusDot />
                    {plan.active ? MAINTENANCE_STATE_LABELS[plan.state] : 'Suspendu'}
                  </Badge>
                  {plan.openIntervention && (
                    <InterventionStatusBadge status={plan.openIntervention.status} />
                  )}
                </div>
                <p className="mt-1.5 font-medium">
                  {plan.name} ·{' '}
                  <Link className="hover:underline" href={href(`/machines/${plan.printer.id}`)}>
                    {plan.printer.name}
                  </Link>
                </p>
                <p className="text-[13px] text-muted-foreground">
                  {[
                    plan.intervalPages &&
                      `Toutes les ${numberFormat.format(plan.intervalPages)} pages`,
                    plan.intervalDays && `tous les ${plan.intervalDays} jours`,
                  ]
                    .filter(Boolean)
                    .join(', ')}{' '}
                  · dernière le {formatDate(plan.last.date)}
                </p>
              </div>
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div
                    className={cn('h-full rounded-full', BAR_TONES[plan.state])}
                    style={{ width: `${Math.min(100, (plan.progress ?? 0) * 100)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                  {plan.pagesSince !== null && plan.intervalPages
                    ? `${numberFormat.format(plan.pagesSince)} / ${numberFormat.format(plan.intervalPages)} pages`
                    : `${plan.daysSince} / ${plan.intervalDays ?? '—'} jours`}
                  {plan.dueAt && ` · échéance ${formatDate(plan.dueAt)}`}
                </p>
              </div>
              {manage && (
                <div className="flex justify-end gap-1.5">
                  {!plan.openIntervention && plan.active && (
                    <Button variant="secondary" size="sm" onClick={() => setPlanning(plan)}>
                      <CalendarClock aria-hidden="true" />
                      Planifier
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Modifier ${plan.name}`}
                    onClick={() => setEditing({ plan })}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <PlanDialog
          key={editing.plan?.id ?? 'new'}
          tenantId={tenantId}
          plan={editing.plan}
          open
          onClose={() => setEditing(null)}
        />
      )}
      {planning && (
        <NewInterventionDialog
          key={planning.id}
          tenantId={tenantId}
          open
          onClose={() => setPlanning(null)}
          preset={{
            printerId: planning.printer.id,
            planId: planning.id,
            title: `Maintenance préventive : ${planning.name}`,
            type: 'PREVENTIVE',
          }}
        />
      )}
    </Panel>
  );
}

export function MaintenancePage() {
  const { tenantId, tenantName } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance"
        description={
          tenantName
            ? `Maintenance préventive du parc de ${tenantName}.`
            : 'Maintenance préventive du parc.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? <MaintenanceView key={tenantId} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
