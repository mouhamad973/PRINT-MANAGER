'use client';

import {
  AGENT_EVENT_TYPE_LABELS,
  type AgentEnrollmentCode,
  type AgentEventType,
  type CollectorAgent,
  type DiscoveredDevice,
} from '@arksen/shared-types';
import { agentCreateSchema, type AgentCreateInput } from '@arksen/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, RadioTower, Router, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { describedBy, Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Panel, PanelHeader } from '@/components/ui/panel';
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
import { fleetApi, fleetKeys } from '@/features/fleet/api';
import { ChooseTenant } from '@/features/fleet/choose-tenant';
import { TenantPicker, useTenantScope } from '@/features/fleet/tenant-scope';
import { numberFormat } from '@/features/meters/meters-ui';
import { useSession } from '@/features/session/session-provider';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { collectorApi, collectorKeys } from './api';

const PAGE_SIZE = 10;

export function AgentStatusBadge({ agent }: { agent: CollectorAgent }) {
  if (agent.status === 'REVOKED') {
    return <Badge>Révoqué</Badge>;
  }
  if (agent.status === 'PENDING') {
    return (
      <Badge tone="warning">
        <StatusDot />
        {agent.enrollmentExpiresAt ? 'En attente d’enregistrement' : 'Code expiré'}
      </Badge>
    );
  }
  return agent.online ? (
    <Badge tone="success">
      <StatusDot />
      Connecté
    </Badge>
  ) : (
    <Badge tone="danger" title="Aucun contact depuis plus de 30 minutes">
      <StatusDot />
      Hors ligne
    </Badge>
  );
}

/** Code d'enregistrement, montré une seule fois, avec la commande à lancer sur le poste. */
function EnrollmentCodeDialog({
  enrollment,
  onClose,
}: {
  enrollment: AgentEnrollmentCode | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const server = typeof window === 'undefined' ? '' : window.location.origin;
  const command = enrollment
    ? `arksen-collector enroll --server ${server} --code ${enrollment.enrollmentCode}`
    : '';
  return (
    <Dialog
      open={enrollment !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
      title={enrollment ? `Code d’enregistrement de ${enrollment.agent.name}` : ''}
      description="Notez-le maintenant : il ne sera plus affiché. Valable 24 heures, pour un seul enregistrement."
    >
      {enrollment && (
        <div className="grid gap-5">
          <p
            className="rounded-xl bg-primary-soft px-4 py-5 text-center font-mono text-2xl font-semibold tracking-[0.12em] text-primary-soft-foreground select-all"
            aria-label="Code d’enregistrement"
          >
            {enrollment.enrollmentCode}
          </p>
          <p className="text-[13px] text-muted-foreground">
            Expire le {formatDateTime(enrollment.expiresAt)}. Saisissez-le dans l’interface locale
            de l’agent (http://127.0.0.1:8765), ou lancez sur le poste :
          </p>
          <pre className="overflow-x-auto rounded-lg border border-border bg-surface-raised px-3.5 py-3 font-mono text-xs">
            {command}
          </pre>
          <div className="flex justify-end gap-2.5">
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(command);
                setCopied(true);
              }}
            >
              <Copy aria-hidden="true" />
              {copied ? 'Commande copiée' : 'Copier la commande'}
            </Button>
            <Button onClick={onClose}>Terminé</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

type AgentValues = z.input<typeof agentCreateSchema>;

function AgentDialog({
  tenantId,
  open,
  onOpenChange,
  onCreated,
}: {
  tenantId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (enrollment: AgentEnrollmentCode) => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const sites = useQuery({
    queryKey: fleetKeys.sites(tenantId, { all: true }),
    queryFn: () => fleetApi.allSites(tenantId),
    enabled: open,
  });
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AgentValues, unknown, AgentCreateInput>({
    resolver: zodResolver(agentCreateSchema),
    defaultValues: { name: '', siteId: '' },
  });

  async function submit(values: AgentCreateInput) {
    setFormError(null);
    try {
      const enrollment = await collectorApi.createAgent(tenantId, values);
      reset({ name: '', siteId: '' });
      onCreated(enrollment);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setError('name', { message: error.message });
        return;
      }
      setFormError(errorMessage(error));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFormError(null);
        onOpenChange(next);
      }}
      title="Nouvel agent de collecte"
      description="Un agent par réseau : il interroge en SNMP les machines qu’il peut joindre."
    >
      <form noValidate className="grid gap-4" onSubmit={handleSubmit(submit)}>
        <FormError message={formError} />
        <Field id="agent-name" label="Nom de l’agent" error={errors.name?.message}>
          <Input
            id="agent-name"
            autoComplete="off"
            placeholder="Poste du siège, serveur de l’agence…"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={describedBy('agent-name', errors.name?.message)}
            {...register('name')}
          />
        </Field>
        <Field
          id="agent-site"
          label="Site couvert"
          hint="Sans site, l’agent interroge toutes les machines de l’entreprise."
          error={errors.siteId?.message}
        >
          <Select id="agent-site" {...register('siteId')}>
            <option value="">Tous les sites</option>
            {sites.data?.items.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Création…' : 'Créer et obtenir le code'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AgentsPanel({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [enrollment, setEnrollment] = useState<AgentEnrollmentCode | null>(null);
  const [revoking, setRevoking] = useState<CollectorAgent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const agents = useQuery({
    queryKey: collectorKeys.agents(tenantId),
    queryFn: () => collectorApi.agents(tenantId),
    refetchInterval: 30_000,
  });
  const manage = can('agents:manage');
  const refresh = () => queryClient.invalidateQueries({ queryKey: collectorKeys.all(tenantId) });

  return (
    <Panel>
      <PanelHeader
        title="Agents"
        description="Chaque agent collecte sur son réseau, garde ses relevés hors ligne et les synchronise dès qu’il peut."
        actions={
          manage && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              Ajouter un agent
            </Button>
          )
        }
      />
      {error && (
        <div className="px-5 pb-4">
          <FormError message={error} />
        </div>
      )}
      {agents.isPending && <Skeleton className="mx-5 mb-5 h-28" />}
      {agents.isError && (
        <div className="px-5 pb-5">
          <FormError message={agents.error.message} />
        </div>
      )}
      {agents.data?.length === 0 && (
        <EmptyState
          icon={RadioTower}
          title="Aucun agent de collecte"
          description="Installez l’agent ARKSEN Collector sur un poste Windows du réseau des imprimantes : il relèvera les compteurs, les niveaux et les alertes en SNMP."
        />
      )}
      {agents.data && agents.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>État</TableHead>
              <TableHead className="hidden lg:table-cell">Poste</TableHead>
              <TableHead className="hidden md:table-cell">Dernier contact</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Événements, 24 h</TableHead>
              {manage && <TableHead className="w-0" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.data.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell>
                  <p className="font-medium">{agent.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {agent.site?.name ?? 'Tous les sites'}
                  </p>
                </TableCell>
                <TableCell>
                  <AgentStatusBadge agent={agent} />
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  {agent.hostname ?? '—'}
                  {agent.version && <p className="text-xs">version {agent.version}</p>}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {agent.lastSeenAt ? formatDateTime(agent.lastSeenAt) : 'Jamais'}
                  {agent.lastSyncAt && (
                    <p className="text-xs">Synchronisé le {formatDateTime(agent.lastSyncAt)}</p>
                  )}
                </TableCell>
                <TableCell className="hidden text-right sm:table-cell">
                  {numberFormat.format(agent.events24h)}
                  {agent.rejected24h > 0 && (
                    <p className="text-xs text-danger">{agent.rejected24h} rejeté(s)</p>
                  )}
                </TableCell>
                {manage && (
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          setError(null);
                          try {
                            setEnrollment(await collectorApi.renewCode(tenantId, agent.id));
                            await refresh();
                          } catch (caught) {
                            setError(errorMessage(caught));
                          }
                        }}
                      >
                        <KeyRound aria-hidden="true" />
                        <span className="sr-only sm:not-sr-only">Nouveau code</span>
                      </Button>
                      {agent.status !== 'REVOKED' && (
                        <Button variant="ghost" size="sm" onClick={() => setRevoking(agent)}>
                          <ShieldOff aria-hidden="true" />
                          <span className="sr-only sm:not-sr-only">Révoquer</span>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AgentDialog
        tenantId={tenantId}
        open={creating}
        onOpenChange={setCreating}
        onCreated={async (created) => {
          setCreating(false);
          setEnrollment(created);
          await refresh();
        }}
      />
      <EnrollmentCodeDialog enrollment={enrollment} onClose={() => setEnrollment(null)} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={revoking ? `Révoquer ${revoking.name} ?` : ''}
        description="Son jeton cesse immédiatement d’être accepté. Ses relevés non synchronisés restent sur le poste : un nouveau code permettra de les envoyer."
        confirmLabel="Révoquer"
        onConfirm={async () => {
          if (!revoking) return;
          await collectorApi.revoke(tenantId, revoking.id);
          setRevoking(null);
          await refresh();
        }}
      />
    </Panel>
  );
}

function AssociateDialog({
  tenantId,
  device,
  onClose,
}: {
  tenantId: string;
  device: DiscoveredDevice | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [printerId, setPrinterId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const printers = useQuery({
    queryKey: fleetKeys.printers(tenantId, { all: true }),
    queryFn: () => fleetApi.printers(tenantId, { pageSize: 100 }),
    enabled: device !== null,
  });
  return (
    <Dialog
      open={device !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null);
          setPrinterId('');
          onClose();
        }
      }}
      title={device ? `Associer ${device.ipAddress}` : ''}
      description="La machine reçoit l’adresse de l’équipement si elle n’en a pas : l’agent l’interrogera à sa prochaine configuration."
    >
      <div className="grid gap-4">
        <FormError message={error} />
        <Field id="device-printer" label="Machine du parc">
          <Select
            id="device-printer"
            value={printerId}
            onChange={(event) => setPrinterId(event.target.value)}
          >
            <option value="">Choisir une machine…</option>
            {printers.data?.items.map((printer) => (
              <option key={printer.id} value={printer.id}>
                {printer.name} · {printer.serialNumber}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={!printerId || pending}
            onClick={async () => {
              if (!device) return;
              setPending(true);
              setError(null);
              try {
                await collectorApi.updateDevice(tenantId, device.id, { printerId });
                await queryClient.invalidateQueries({ queryKey: fleetKeys.all(tenantId) });
                setPrinterId('');
                onClose();
              } catch (caught) {
                setError(errorMessage(caught));
              } finally {
                setPending(false);
              }
            }}
          >
            Associer
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function DevicesPanel({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const { href } = useTenantScope();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [associating, setAssociating] = useState<DiscoveredDevice | null>(null);
  const devices = useQuery({
    queryKey: collectorKeys.devices(tenantId, { search, page }),
    queryFn: () => collectorApi.devices(tenantId, { search, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);
  const manage = can('agents:manage');

  return (
    <Panel>
      <PanelHeader
        title="Équipements découverts"
        description="Imprimantes trouvées par la découverte réseau des agents"
        actions={
          <SearchInput
            label="Rechercher un équipement"
            placeholder="Adresse, série…"
            onSearch={onSearch}
          />
        }
      />
      {devices.isPending && <Skeleton className="mx-5 mb-5 h-24" />}
      {devices.data?.total === 0 && (
        <EmptyState
          icon={Router}
          title={search ? 'Aucun équipement ne correspond' : 'Aucun équipement découvert'}
          description={
            search
              ? 'Modifiez la recherche.'
              : 'Indiquez des plages d’adresses dans l’interface locale d’un agent : il y cherchera les imprimantes.'
          }
        />
      )}
      {devices.data && devices.data.total > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Adresse</TableHead>
                <TableHead>Équipement</TableHead>
                <TableHead className="hidden md:table-cell">Machine du parc</TableHead>
                <TableHead className="hidden lg:table-cell">Vu le</TableHead>
                {manage && <TableHead className="w-0" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.data.items.map((device) => (
                <TableRow key={device.id} className={device.ignored ? 'opacity-60' : undefined}>
                  <TableCell className="font-mono text-[13px]">
                    {device.ipAddress}
                    {device.macAddress && (
                      <p className="text-xs text-muted-foreground">{device.macAddress}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{device.description ?? device.sysName ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">
                      {device.serialNumber
                        ? `Série ${device.serialNumber}`
                        : 'Numéro de série inconnu'}
                      {' · '}
                      {device.agentName}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {device.printer ? (
                      <Link
                        className="font-medium hover:underline"
                        href={href(`/machines/${device.printer.id}`)}
                      >
                        {device.printer.name}
                      </Link>
                    ) : device.ignored ? (
                      <Badge>Ignoré</Badge>
                    ) : (
                      <Badge tone="warning">
                        <StatusDot />
                        Hors du parc
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {formatDateTime(device.lastSeenAt)}
                  </TableCell>
                  {manage && (
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        {!device.printer && (
                          <Button variant="ghost" size="sm" onClick={() => setAssociating(device)}>
                            Associer
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            await collectorApi.updateDevice(tenantId, device.id, {
                              ignored: !device.ignored,
                            });
                            await queryClient.invalidateQueries({
                              queryKey: collectorKeys.all(tenantId),
                            });
                          }}
                        >
                          {device.ignored ? 'Réafficher' : 'Ignorer'}
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={devices.data.total}
            onPageChange={setPage}
          />
        </>
      )}
      <AssociateDialog
        tenantId={tenantId}
        device={associating}
        onClose={() => setAssociating(null)}
      />
    </Panel>
  );
}

function SyncPanel({ tenantId }: { tenantId: string }) {
  const [page, setPage] = useState(1);
  const logs = useQuery({
    queryKey: collectorKeys.syncLogs(tenantId, { page }),
    queryFn: () => collectorApi.syncLogs(tenantId, { page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const rejected = useQuery({
    queryKey: collectorKeys.rejected(tenantId),
    queryFn: () => collectorApi.rejected(tenantId, { pageSize: 5 }),
  });

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <Panel>
        <PanelHeader
          title="Journal des synchronisations"
          description="Lots reçus des agents : chaque événement est acquitté une fois, même renvoyé"
        />
        {logs.isPending && <Skeleton className="mx-5 mb-5 h-24" />}
        {logs.data?.total === 0 && (
          <p className="px-5 pb-6 text-[13px] text-muted-foreground">
            Aucune synchronisation reçue pour l’instant.
          </p>
        )}
        {logs.data && logs.data.total > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reçu le</TableHead>
                  <TableHead className="hidden sm:table-cell">Agent</TableHead>
                  <TableHead className="text-right">Événements</TableHead>
                  <TableHead className="text-right">Acceptés</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Doublons</TableHead>
                  <TableHead className="text-right">Rejetés</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.data.items.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(log.receivedAt)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{log.agentName}</TableCell>
                    <TableCell className="text-right">
                      {numberFormat.format(log.received)}
                    </TableCell>
                    <TableCell className="text-right">
                      {numberFormat.format(log.accepted)}
                    </TableCell>
                    <TableCell className="hidden text-right md:table-cell">
                      {numberFormat.format(log.duplicates)}
                    </TableCell>
                    <TableCell
                      className={
                        log.rejected > 0 ? 'text-right font-medium text-danger' : 'text-right'
                      }
                    >
                      {numberFormat.format(log.rejected)}
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
      <Panel>
        <PanelHeader
          title="Événements rejetés"
          description="L’agent les garde, marqués rejetés, et ne les renvoie plus"
        />
        {rejected.data?.total === 0 && (
          <p className="px-5 pb-6 text-[13px] text-muted-foreground">Aucun événement rejeté.</p>
        )}
        <ul className="divide-y divide-border px-5 pb-3">
          {rejected.data?.items.map((event) => (
            <li key={event.id} className="py-3 text-[13px]">
              <p className="font-medium">
                {AGENT_EVENT_TYPE_LABELS[event.type as AgentEventType] ?? event.type}
                {event.printerName && ` · ${event.printerName}`}
              </p>
              <p className="text-danger">{event.error}</p>
              <p className="text-xs text-muted-foreground">
                {event.agentName} · {formatDateTime(event.occurredAt)}
              </p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

export function CollectorPage() {
  const { tenantId, tenantName } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents de collecte"
        description={
          tenantName
            ? `Collecte SNMP automatique du parc de ${tenantName} : compteurs, niveaux, états et alertes.`
            : 'Collecte SNMP automatique du parc : compteurs, niveaux, états et alertes.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? (
        <>
          <AgentsPanel key={`agents-${tenantId}`} tenantId={tenantId} />
          <DevicesPanel key={`devices-${tenantId}`} tenantId={tenantId} />
          <SyncPanel key={`sync-${tenantId}`} tenantId={tenantId} />
        </>
      ) : (
        <ChooseTenant />
      )}
    </div>
  );
}
