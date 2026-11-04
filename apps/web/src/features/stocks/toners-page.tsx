'use client';

import { CMYK_CHANNELS, type CmykChannel, type DetectedReplacement } from '@arksen/shared-types';
import { tonerReplacementCreateSchema } from '@arksen/validation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Blocks, Repeat, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Panel, PanelHeader } from '@/components/ui/panel';
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
import { Textarea } from '@/components/ui/textarea';
import { InkLabel } from '@/features/consumption/consumption-ui';
import { fleetApi, fleetKeys } from '@/features/fleet/api';
import { ChooseTenant } from '@/features/fleet/choose-tenant';
import { TenantPicker, useTenantScope } from '@/features/fleet/tenant-scope';
import { numberFormat } from '@/features/meters/meters-ui';
import { useSession } from '@/features/session/session-provider';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { stockApi, stockKeys } from './api';
import { decimal, formatAmount } from './stocks-ui';

const PAGE_SIZE = 15;

/** Date et heure locales au format d'un champ datetime-local. */
function localInput(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

interface Prefill {
  printerId: string;
  channel: CmykChannel;
  replacedAt: string;
}

function ReplacementDialog({
  tenantId,
  prefill,
  open,
  onClose,
}: {
  tenantId: string;
  prefill: Prefill | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const current = {
    printerId: prefill?.printerId ?? '',
    channel: prefill?.channel ?? 'BLACK',
    replacedAt: prefill ? localInput(new Date(prefill.replacedAt)) : localInput(new Date()),
    stockId: '',
    previousLevelPercent: '',
    notes: '',
    ...values,
  };
  const set = (key: string) => (value: string) => setValues((old) => ({ ...old, [key]: value }));
  const printers = useQuery({
    queryKey: fleetKeys.printers(tenantId, { all: true }),
    queryFn: () => fleetApi.printers(tenantId, { pageSize: 100 }),
    enabled: open,
  });
  const stocks = useQuery({
    queryKey: stockKeys.stocks(tenantId, { all: true }),
    queryFn: () => stockApi.stocks(tenantId, { pageSize: 100 }),
    enabled: open,
  });
  const printer = printers.data?.items.find((item) => item.id === current.printerId);
  const channels: readonly CmykChannel[] =
    printer?.model.colorMode === 'MONOCHROME' ? ['BLACK'] : CMYK_CHANNELS;
  const candidates =
    stocks.data?.items.filter((stock) => stock.channel === current.channel && stock.quantity > 0) ??
    [];

  function close() {
    setValues({});
    setError(null);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = tonerReplacementCreateSchema.safeParse({
      ...current,
      replacedAt: current.replacedAt ? new Date(current.replacedAt).toISOString() : '',
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Saisie invalide.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await stockApi.replace(tenantId, parsed.data);
      await queryClient.invalidateQueries({ queryKey: fleetKeys.all(tenantId) });
      close();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title="Remplacement de toner"
      description="Le compteur du moment donne le rendement réel de la cartouche retirée."
    >
      <form noValidate className="grid gap-4" onSubmit={submit}>
        <FormError message={error} />
        <Field id="replacement-printer" label="Machine">
          <Select
            id="replacement-printer"
            value={current.printerId}
            onChange={(e) => set('printerId')(e.target.value)}
          >
            <option value="">Choisir une machine…</option>
            {printers.data?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.site.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="replacement-channel" label="Couleur">
            <Select
              id="replacement-channel"
              value={current.channel}
              onChange={(e) => {
                set('channel')(e.target.value);
                set('stockId')('');
              }}
            >
              {channels.map((channel) => (
                <option key={channel} value={channel}>
                  {{ CYAN: 'Cyan', MAGENTA: 'Magenta', YELLOW: 'Jaune', BLACK: 'Noir' }[channel]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="replacement-date" label="Date du remplacement">
            <Input
              id="replacement-date"
              type="datetime-local"
              value={current.replacedAt}
              onChange={(e) => set('replacedAt')(e.target.value)}
            />
          </Field>
        </div>
        <Field
          id="replacement-stock"
          label="Cartouche prise dans le stock"
          hint="Facultatif : le stock est alors diminué d’une cartouche."
        >
          <Select
            id="replacement-stock"
            value={current.stockId}
            onChange={(e) => set('stockId')(e.target.value)}
          >
            <option value="">Hors stock suivi</option>
            {candidates.map((stock) => (
              <option key={stock.id} value={stock.id}>
                {stock.reference} · {stock.site.name} ({stock.quantity} en stock)
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <Field id="replacement-level" label="Niveau retiré" hint="%, facultatif">
            <Input
              id="replacement-level"
              inputMode="decimal"
              placeholder="Niveau SNMP"
              value={current.previousLevelPercent}
              onChange={(e) => set('previousLevelPercent')(e.target.value)}
            />
          </Field>
          <Field id="replacement-notes" label="Notes">
            <Textarea
              id="replacement-notes"
              className="min-h-10"
              value={current.notes}
              onChange={(e) => set('notes')(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Enregistrement…' : 'Enregistrer le remplacement'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function References({ tenantId }: { tenantId: string }) {
  const references = useQuery({
    queryKey: stockKeys.references(tenantId),
    queryFn: () => stockApi.references(tenantId),
  });
  return (
    <Panel>
      <PanelHeader
        title="Références"
        description="Toners des fiches techniques du parc. Le rendement constaté se mesure entre deux remplacements."
      />
      {references.isPending && <Skeleton className="mx-5 mb-5 h-32" />}
      {references.data?.length === 0 && (
        <EmptyState
          icon={Blocks}
          title="Aucun toner renseigné"
          description="Renseignez les toners (référence, masse, rendement) dans les fiches techniques des modèles."
        />
      )}
      {references.data && references.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Référence</TableHead>
              <TableHead className="hidden lg:table-cell">Modèles</TableHead>
              <TableHead className="hidden text-right md:table-cell">Machines</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Remplacements, 90 j</TableHead>
              <TableHead className="text-right">Rendement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {references.data.map((reference) => {
              const ratio =
                reference.averageYield !== null
                  ? reference.averageYield / reference.yieldPages
                  : null;
              return (
                <TableRow key={reference.reference}>
                  <TableCell>
                    <p className="font-medium">{reference.reference}</p>
                    <InkLabel
                      channel={reference.channel}
                      className="text-xs text-muted-foreground"
                    />
                  </TableCell>
                  <TableCell className="hidden max-w-72 text-[13px] text-muted-foreground lg:table-cell">
                    {reference.models.map((model) => model.name).join(', ')}
                    <p className="text-xs">
                      {decimal.format(reference.capacityGrams)} g ·{' '}
                      {formatAmount(reference.unitPrice, reference.currency)}
                    </p>
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    {reference.printers}
                  </TableCell>
                  <TableCell className="text-right font-medium">{reference.stock}</TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    {reference.replacements90d}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {numberFormat.format(reference.yieldPages)} p.
                    <p className="text-xs text-muted-foreground">
                      {reference.averageYield === null
                        ? 'constructeur ; pas encore mesuré'
                        : `constaté ${numberFormat.format(reference.averageYield)} p. (${decimal.format((ratio ?? 0) * 100)} %, ${reference.yieldSamples} mesure(s))`}
                    </p>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

function Detected({
  tenantId,
  onRecord,
}: {
  tenantId: string;
  onRecord: (item: DetectedReplacement) => void;
}) {
  const { can } = useSession();
  const detected = useQuery({
    queryKey: stockKeys.detected(tenantId),
    queryFn: () => stockApi.detected(tenantId),
  });
  if (!detected.data?.length) return null;
  return (
    <Panel>
      <PanelHeader
        title="Remplacements à confirmer"
        description="Le niveau de ces cartouches est remonté d’un coup selon l’agent de collecte, sans remplacement enregistré."
      />
      <ul className="divide-y divide-border px-5 pb-3">
        {detected.data.map((item) => (
          <li
            key={`${item.printer.id}-${item.channel}-${item.detectedAt}`}
            className="flex flex-wrap items-center justify-between gap-3 py-3 text-[13px]"
          >
            <div>
              <p className="font-medium">
                {item.printer.name} · <InkLabel channel={item.channel} />
              </p>
              <p className="text-muted-foreground">
                {decimal.format(item.levelBefore)} % puis {decimal.format(item.levelAfter)} %, le{' '}
                {formatDateTime(item.detectedAt)}
              </p>
            </div>
            {can('toner-replacements:manage') && (
              <Button variant="secondary" size="sm" onClick={() => onRecord(item)}>
                Enregistrer le remplacement
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function History({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const { href } = useTenantScope();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const replacements = useQuery({
    queryKey: stockKeys.replacements(tenantId, { page }),
    queryFn: () => stockApi.replacements(tenantId, { page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const manage = can('toner-replacements:manage');
  return (
    <Panel>
      <PanelHeader title="Historique des remplacements" />
      {replacements.isPending && <Skeleton className="mx-5 mb-5 h-24" />}
      {replacements.data?.total === 0 && (
        <p className="px-5 pb-6 text-[13px] text-muted-foreground">
          Aucun remplacement enregistré.
        </p>
      )}
      {replacements.data && replacements.data.total > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Machine</TableHead>
                <TableHead className="hidden md:table-cell">Cartouche</TableHead>
                <TableHead className="text-right">Rendement de la précédente</TableHead>
                <TableHead className="hidden lg:table-cell">Stock</TableHead>
                {manage && <TableHead className="w-0" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {replacements.data.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(item.replacedAt)}
                  </TableCell>
                  <TableCell>
                    <Link
                      className="font-medium hover:underline"
                      href={href(`/machines/${item.printer.id}`)}
                    >
                      {item.printer.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{item.printer.siteName}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <InkLabel channel={item.channel} />
                    <p className="text-xs text-muted-foreground">
                      {item.reference ?? 'Toner non renseigné'}
                      {item.previousLevelPercent !== null &&
                        ` · retirée à ${decimal.format(item.previousLevelPercent)} %`}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.pagesSincePrevious === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <>
                        {numberFormat.format(item.pagesSincePrevious)} p.
                        {item.yieldPages && (
                          <p className="text-xs text-muted-foreground">
                            {decimal.format((item.pagesSincePrevious / item.yieldPages) * 100)} % du
                            rendement constructeur
                          </p>
                        )}
                      </>
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {item.stock ? (
                      <Badge>{item.stock.siteName}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {manage && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Annuler ce remplacement"
                        onClick={() => setCancelling(item.id)}
                      >
                        <Undo2 aria-hidden="true" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={replacements.data.total}
            onPageChange={setPage}
          />
        </>
      )}
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title="Annuler ce remplacement ?"
        description="Il disparaît de l’historique ; si la cartouche venait d’un stock, elle y revient."
        confirmLabel="Annuler le remplacement"
        onConfirm={async () => {
          if (!cancelling) return;
          await stockApi.cancelReplacement(tenantId, cancelling);
          setCancelling(null);
          await queryClient.invalidateQueries({ queryKey: fleetKeys.all(tenantId) });
        }}
      />
    </Panel>
  );
}

function TonersView({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const [dialog, setDialog] = useState<{ prefill: Prefill | null } | null>(null);
  return (
    <>
      {can('toner-replacements:manage') && (
        <div className="flex justify-end">
          <Button onClick={() => setDialog({ prefill: null })}>
            <Repeat aria-hidden="true" />
            Enregistrer un remplacement
          </Button>
        </div>
      )}
      <Detected
        tenantId={tenantId}
        onRecord={(item) =>
          setDialog({
            prefill: {
              printerId: item.printer.id,
              channel: item.channel,
              replacedAt: item.detectedAt,
            },
          })
        }
      />
      <References tenantId={tenantId} />
      <History tenantId={tenantId} />
      <ReplacementDialog
        key={dialog ? JSON.stringify(dialog.prefill) : 'closed'}
        tenantId={tenantId}
        prefill={dialog?.prefill ?? null}
        open={dialog !== null}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

export function TonersPage() {
  const { tenantId, tenantName } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Toners"
        description={
          tenantName
            ? `Toners du parc de ${tenantName} : références, remplacements et rendement réel de chaque cartouche.`
            : 'Toners du parc : références, remplacements et rendement réel de chaque cartouche.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? <TonersView key={tenantId} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
