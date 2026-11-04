'use client';

import {
  PRINT_TECHNOLOGY_LABELS,
  PRINTER_STATUS_LABELS,
  PRINTER_STATUSES,
  SNMP_VERSION_LABELS,
  type PrinterDetail,
  type PrinterModel,
  type PrinterStatus,
} from '@arksen/shared-types';
import type { PrinterConnectionInput, PrinterCreateInput } from '@arksen/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormError } from '@/components/ui/field';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PrinterConsumption } from '@/features/consumption/printer-consumption';
import { PrinterMeters } from '@/features/meters/printer-meters';
import { useSession } from '@/features/session/session-provider';
import { errorMessage } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { fleetApi, fleetKeys, send } from './api';
import { ChooseTenant } from './choose-tenant';
import { ColorModeTag, ConnectivityBadge, PrinterStatusBadge } from './fleet-badges';
import { NetworkForm } from './network-form';
import { PrinterDialog } from './printer-dialog';
import { TenantPicker, useTenantScope } from './tenant-scope';

const numberFormat = new Intl.NumberFormat('fr-FR');

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium break-words">{children ?? '—'}</dd>
    </div>
  );
}

function perMonth(value: number | null) {
  return value === null ? null : `${numberFormat.format(value)} pages / mois`;
}

function ModelSheet({ tenantId, modelId }: { tenantId: string; modelId: string }) {
  const model = useQuery({
    queryKey: [...fleetKeys.all(tenantId), 'model', modelId],
    queryFn: () => fleetApi.model(tenantId, modelId),
  });
  const sheet: PrinterModel | null | undefined = model.data;

  return (
    <Panel aria-labelledby="model-title">
      <PanelHeader
        title={<span id="model-title">Fiche technique</span>}
        actions={
          sheet &&
          (sheet.tenantId ? (
            <Badge>Entreprise</Badge>
          ) : (
            <Badge tone="brand">Catalogue Arksen</Badge>
          ))
        }
      />
      {model.isPending && <Skeleton className="mx-5 mb-5 h-32" />}
      {sheet && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 pb-6">
          <Detail label="Fabricant">{sheet.manufacturer}</Detail>
          <Detail label="Modèle">{sheet.name}</Detail>
          <Detail label="Impression">
            <ColorModeTag colorMode={sheet.colorMode} />
          </Detail>
          <Detail label="Technologie">{PRINT_TECHNOLOGY_LABELS[sheet.technology]}</Detail>
          <Detail label="Format maximal">
            {sheet.maxFormat}
            {sheet.duplex ? ', recto verso' : ''}
          </Detail>
          <Detail label="Vitesse">
            {[
              sheet.speedMonoPpm && `${sheet.speedMonoPpm} ppm N&B`,
              sheet.speedColorPpm && `${sheet.speedColorPpm} ppm couleur`,
            ]
              .filter(Boolean)
              .join(' · ') || null}
          </Detail>
          <Detail label="Volume maximal">{perMonth(sheet.monthlyDutyCycle)}</Detail>
          <Detail label="Volume recommandé">{perMonth(sheet.recommendedVolume)}</Detail>
        </dl>
      )}
    </Panel>
  );
}

function PrinterDetailView({ tenantId, printerId }: { tenantId: string; printerId: string }) {
  const { can } = useSession();
  const { href } = useTenantScope();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const base = `/tenants/${tenantId}/printers/${printerId}`;
  const printer = useQuery({
    queryKey: fleetKeys.printer(tenantId, printerId),
    queryFn: () => fleetApi.printer(tenantId, printerId),
  });

  async function apply(update: Promise<PrinterDetail>) {
    const updated = await update;
    queryClient.setQueryData(fleetKeys.printer(tenantId, printerId), updated);
    await queryClient.invalidateQueries({ queryKey: fleetKeys.all(tenantId) });
    return updated;
  }

  if (printer.isPending) {
    return (
      <div className="space-y-4" role="status" aria-label="Chargement de la machine">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-56" />
      </div>
    );
  }
  if (printer.isError) {
    return <FormError message={errorMessage(printer.error, 'Machine introuvable.')} />;
  }

  const data = printer.data;
  const canManage = can('printers:manage');
  const canConfigure = can('printers:network:manage');
  const connection = data.connection;

  return (
    <div className="space-y-6">
      <Link
        href={href('/machines')}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Machines
      </Link>
      <PageHeader
        title={data.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {data.model.manufacturer} {data.model.name} · {data.site.name}
            <PrinterStatusBadge status={data.status} />
          </span>
        }
        actions={
          canManage && (
            <>
              <div className="w-48">
                <Select
                  aria-label="Changer le statut"
                  value={data.status}
                  onChange={async (event) => {
                    setStatusError(null);
                    try {
                      await apply(
                        send<PrinterDetail>('PATCH', base, {
                          status: event.target.value as PrinterStatus,
                        }),
                      );
                    } catch (error) {
                      setStatusError(errorMessage(error));
                    }
                  }}
                >
                  {PRINTER_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {PRINTER_STATUS_LABELS[status]}
                    </option>
                  ))}
                </Select>
              </div>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" />
                Modifier
              </Button>
            </>
          )
        }
      />
      <FormError message={statusError} />

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel aria-labelledby="identity-title" className="xl:col-span-3">
          <PanelHeader title={<span id="identity-title">Identification</span>} />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 pb-6 md:grid-cols-3">
            <Detail label="Numéro de série">
              <span className="font-mono">{data.serialNumber}</span>
            </Detail>
            <Detail label="Numéro d’inventaire">{data.assetTag}</Detail>
            <Detail label="Site">
              <Link
                href={href(`/machines?site=${data.site.id}`)}
                className="text-primary hover:underline"
              >
                {data.site.name}
              </Link>
            </Detail>
            <Detail label="Emplacement">{data.location}</Detail>
            <Detail label="Installée le">{data.installedAt && formatDate(data.installedAt)}</Detail>
            <Detail label="Ajoutée au parc le">{formatDate(data.createdAt)}</Detail>
            {data.notes && (
              <div className="col-span-2 md:col-span-3">
                <Detail label="Notes">
                  <span className="font-normal whitespace-pre-line">{data.notes}</span>
                </Detail>
              </div>
            )}
          </dl>
        </Panel>
        <div className="xl:col-span-2">
          <ModelSheet tenantId={tenantId} modelId={data.model.id} />
        </div>
      </div>

      {can('meters:read') && (
        <PrinterMeters tenantId={tenantId} printerId={printerId} colorMode={data.model.colorMode} />
      )}

      {can('consumption:read') && (
        <PrinterConsumption
          tenantId={tenantId}
          printerId={printerId}
          colorMode={data.model.colorMode}
          modelId={data.model.id}
        />
      )}

      <Panel aria-labelledby="network-title">
        <PanelHeader
          title={<span id="network-title">Réseau et SNMP</span>}
          description="Utilisés par l’agent de collecte pour interroger la machine (phase 7)."
          actions={<ConnectivityBadge connectivity={data.connectivity} />}
        />
        <div className="px-5 pb-6">
          <p className="mb-5 text-[13px] text-muted-foreground">
            {data.lastSeenAt
              ? `Dernière réponse le ${formatDateTime(data.lastSeenAt)}.`
              : 'Aucune mesure : la machine n’a encore jamais été interrogée.'}
          </p>
          {canConfigure ? (
            <NetworkForm
              connection={connection}
              onSubmit={(values: PrinterConnectionInput) =>
                apply(send<PrinterDetail>('PUT', `${base}/connection`, values))
              }
              onClear={() => setClearing(true)}
            />
          ) : connection ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
              <Detail label="Adresse IP">
                <span className="font-mono">{connection.ipAddress}</span>
              </Detail>
              <Detail label="Nom d’hôte">{connection.hostname}</Detail>
              <Detail label="SNMP">
                {SNMP_VERSION_LABELS[connection.snmpVersion]}, port {connection.snmpPort}
              </Detail>
              <Detail label="Secrets">Enregistrés et chiffrés</Detail>
            </dl>
          ) : (
            <p className="text-muted-foreground">Aucune configuration réseau.</p>
          )}
        </div>
      </Panel>

      <PrinterDialog
        open={editing}
        onOpenChange={setEditing}
        tenantId={tenantId}
        printer={data}
        onSubmit={async (values: PrinterCreateInput) => {
          await apply(send<PrinterDetail>('PATCH', base, values));
          setEditing(false);
        }}
      />
      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title="Supprimer la configuration réseau ?"
        description="L’adresse et les secrets SNMP de la machine seront effacés. L’agent ne pourra plus l’interroger."
        confirmLabel="Supprimer la configuration"
        onConfirm={() => apply(send<PrinterDetail>('DELETE', `${base}/connection`))}
      />
    </div>
  );
}

export function PrinterDetailPage({ printerId }: { printerId: string }) {
  const { tenantId, isPlatform } = useTenantScope();
  if (!tenantId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Machine" actions={isPlatform && <TenantPicker />} />
        <ChooseTenant />
      </div>
    );
  }
  return <PrinterDetailView tenantId={tenantId} printerId={printerId} />;
}
