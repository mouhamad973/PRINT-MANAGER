'use client';

import {
  BILLING_PERIOD_LABELS,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUSES,
  INVOICE_STATUS_LABELS,
  type Contract,
  type Invoice,
} from '@arksen/shared-types';
import {
  contractCreateSchema,
  contractUpdateSchema,
  invoiceCreateSchema,
} from '@arksen/validation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, FileSignature, Pencil, Plus, Printer, Send, Undo2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FormError } from '@/components/ui/field';
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
import { Textarea } from '@/components/ui/textarea';
import { fleetApi, fleetKeys } from '@/features/fleet/api';
import { ChooseTenant } from '@/features/fleet/choose-tenant';
import { TenantPicker, useTenantScope } from '@/features/fleet/tenant-scope';
import { numberFormat } from '@/features/meters/meters-ui';
import { useSession } from '@/features/session/session-provider';
import { FormDialog, firstIssue } from '@/features/stocks/stock-dialogs';
import { errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { opsApi, opsKeys } from './api';
import { money, pageCost } from './ops-ui';

const INVOICE_TONES = { DRAFT: 'warning', ISSUED: 'success', CANCELLED: 'neutral' } as const;

function ContractDialog({
  tenantId,
  contract,
  onClose,
}: {
  tenantId: string;
  contract: Contract | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [values, setValues] = useState<Record<string, string>>({
    reference: contract?.reference ?? '',
    customerName: contract?.customerName ?? '',
    customerContact: contract?.customerContact ?? '',
    status: contract?.status ?? 'ACTIVE',
    startDate: contract?.startDate ?? today,
    endDate: contract?.endDate ?? '',
    billingPeriod: contract?.billingPeriod ?? 'MONTHLY',
    fixedFee: String(contract?.fixedFee ?? 0),
    includedBlackPages: String(contract?.includedBlackPages ?? 0),
    includedColorPages: String(contract?.includedColorPages ?? 0),
    blackPagePrice: contract ? String(contract.blackPagePrice) : '',
    colorPagePrice: contract ? String(contract.colorPagePrice) : '',
    notes: contract?.notes ?? '',
  });
  const set = (key: string) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const field = (key: string, label: string, hint?: string, type = 'text') => (
    <Field id={`contract-${key}`} label={label} hint={hint}>
      <Input
        id={`contract-${key}`}
        type={type}
        inputMode={type === 'text' && /Price|Fee|Pages/.test(key) ? 'decimal' : undefined}
        value={values[key]}
        onChange={(e) => set(key)(e.target.value)}
      />
    </Field>
  );
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={contract ? `Contrat ${contract.reference}` : 'Nouveau contrat'}
      description="Forfait par période de facturation, pages incluses, et prix des pages au-delà."
      submitLabel={contract ? 'Enregistrer' : 'Créer le contrat'}
      onSubmit={async () => {
        const parsed = (contract ? contractUpdateSchema : contractCreateSchema).safeParse(values);
        if (!parsed.success) return firstIssue(parsed.error);
        if (contract) await opsApi.updateContract(tenantId, contract.id, parsed.data);
        else await opsApi.createContract(tenantId, parsed.data as never);
        await queryClient.invalidateQueries({ queryKey: opsKeys.all(tenantId) });
        return null;
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        {field('reference', 'Référence')}
        {field('customerName', 'Client')}
      </div>
      {field('customerContact', 'Contact du client', 'Facultatif')}
      <div className="grid gap-4 sm:grid-cols-3">
        {field('startDate', 'Début', undefined, 'date')}
        {field('endDate', 'Fin', 'Facultative', 'date')}
        <Field id="contract-status" label="État">
          <Select
            id="contract-status"
            value={values.status}
            onChange={(e) => set('status')(e.target.value)}
          >
            {CONTRACT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {CONTRACT_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="contract-billing" label="Facturation">
          <Select
            id="contract-billing"
            value={values.billingPeriod}
            onChange={(e) => set('billingPeriod')(e.target.value)}
          >
            <option value="MONTHLY">{BILLING_PERIOD_LABELS.MONTHLY}</option>
            <option value="QUARTERLY">{BILLING_PERIOD_LABELS.QUARTERLY}</option>
          </Select>
        </Field>
        {field('fixedFee', 'Forfait par période')}
        {field('includedBlackPages', 'Pages noir et blanc incluses')}
        {field('includedColorPages', 'Pages couleur incluses')}
        {field('blackPagePrice', 'Prix de la page noir et blanc', 'Au-delà des pages incluses')}
        {field('colorPagePrice', 'Prix de la page couleur', 'Au-delà des pages incluses')}
      </div>
      <Field id="contract-notes" label="Notes">
        <Textarea
          id="contract-notes"
          value={values.notes}
          onChange={(e) => set('notes')(e.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

function PrintersDialog({
  tenantId,
  contract,
  onClose,
}: {
  tenantId: string;
  contract: Contract;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState(
    () => new Set(contract.printers.map((printer) => printer.id)),
  );
  const printers = useQuery({
    queryKey: fleetKeys.printers(tenantId, { all: true }),
    queryFn: () => fleetApi.printers(tenantId, { pageSize: 100 }),
  });
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Machines du contrat ${contract.reference}`}
      description="Une machine n’est couverte que par un contrat à la fois."
      submitLabel="Enregistrer"
      onSubmit={async () => {
        await opsApi.setContractPrinters(tenantId, contract.id, [...chosen]);
        await queryClient.invalidateQueries({ queryKey: opsKeys.all(tenantId) });
        return null;
      }}
    >
      <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {printers.data?.items.map((printer) => (
          <li key={printer.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 text-sm hover:bg-muted/50">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={chosen.has(printer.id)}
                onChange={(event) => {
                  const next = new Set(chosen);
                  if (event.target.checked) next.add(printer.id);
                  else next.delete(printer.id);
                  setChosen(next);
                }}
              />
              <span className="flex-1">
                {printer.name}
                <span className="block text-xs text-muted-foreground">
                  {printer.serialNumber} · {printer.site.name}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </FormDialog>
  );
}

function InvoiceDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const currency = invoice.currency;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={invoice.number ? `Relevé ${invoice.number}` : 'Relevé brouillon'}
      description={`${invoice.contract.customerName} · contrat ${invoice.contract.reference} · du ${formatDate(invoice.periodStart)} au ${formatDate(invoice.periodEnd)}`}
      className="max-w-2xl"
    >
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="pb-2 text-left font-medium">Machine</th>
            <th className="pb-2 text-right font-medium">Noir et blanc</th>
            <th className="pb-2 text-right font-medium">Couleur</th>
            <th className="pb-2 text-right font-medium">Relevés</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {invoice.lines.map((line) => (
            <tr key={line.printerId}>
              <td className="py-2">
                {line.name}
                <span className="block text-xs text-muted-foreground">{line.serialNumber}</span>
              </td>
              <td className="py-2 text-right tabular-nums">
                {numberFormat.format(line.blackPages)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {numberFormat.format(line.colorPages)}
              </td>
              <td
                className={cn('py-2 text-right tabular-nums', line.coverage < 1 && 'text-warning')}
              >
                {Math.round(line.coverage * 100)} %
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-5 grid gap-2 rounded-xl bg-surface-raised p-4 text-[13px]">
        <div className="flex justify-between">
          <dt>Forfait</dt>
          <dd className="tabular-nums">{money(invoice.fixedFee, currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>
            {numberFormat.format(invoice.extraBlackPages)} pages noir et blanc au-delà de{' '}
            {numberFormat.format(invoice.includedBlackPages)}, à{' '}
            {pageCost(invoice.blackPagePrice, currency)}
          </dt>
          <dd className="tabular-nums">{money(invoice.extraBlackAmount, currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>
            {numberFormat.format(invoice.extraColorPages)} pages couleur au-delà de{' '}
            {numberFormat.format(invoice.includedColorPages)}, à{' '}
            {pageCost(invoice.colorPagePrice, currency)}
          </dt>
          <dd className="tabular-nums">{money(invoice.extraColorAmount, currency)}</dd>
        </div>
        <div className="flex justify-between border-t border-border pt-2 font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{money(invoice.totalAmount, currency)}</dd>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <dt>Coût de revient des machines · marge</dt>
          <dd className="tabular-nums">
            {money(invoice.cost, currency)} · {money(invoice.margin, currency)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Pages relevées sur les compteurs, réparties à parts égales entre deux relevés. Une
        couverture inférieure à 100 % signale une période en partie sans relevé.
      </p>
      <div className="mt-5 flex justify-end gap-2.5 print:hidden">
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer aria-hidden="true" />
          Imprimer
        </Button>
        <Button onClick={onClose}>Fermer</Button>
      </div>
    </Dialog>
  );
}

function previousMonth(): { periodStart: string; periodEnd: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

function NewInvoiceDialog({
  tenantId,
  contract,
  onClose,
}: {
  tenantId: string;
  contract: Contract;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(previousMonth);
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Relevé du contrat ${contract.reference}`}
      description="Le brouillon reprend les pages relevées de chaque machine du contrat. Vérifiez-le, puis émettez-le."
      submitLabel="Établir le brouillon"
      onSubmit={async () => {
        const parsed = invoiceCreateSchema.safeParse(values);
        if (!parsed.success) return firstIssue(parsed.error);
        await opsApi.createInvoice(tenantId, contract.id, parsed.data);
        await queryClient.invalidateQueries({ queryKey: opsKeys.all(tenantId) });
        return null;
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="invoice-start" label="Du">
          <Input
            id="invoice-start"
            type="date"
            value={values.periodStart}
            onChange={(e) => setValues({ ...values, periodStart: e.target.value })}
          />
        </Field>
        <Field id="invoice-end" label="Au">
          <Input
            id="invoice-end"
            type="date"
            value={values.periodEnd}
            onChange={(e) => setValues({ ...values, periodEnd: e.target.value })}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

function Invoices({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [shown, setShown] = useState<Invoice | null>(null);
  const [cancelling, setCancelling] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invoices = useQuery({
    queryKey: opsKeys.key(tenantId, 'invoices', { page }),
    queryFn: () => opsApi.invoices(tenantId, { page, pageSize: 10 }),
    placeholderData: keepPreviousData,
  });
  const manage = can('contracts:manage');
  return (
    <Panel>
      <PanelHeader
        title="Relevés de facturation"
        description="Un relevé émis reçoit son numéro et ne se modifie plus : il s’annule."
      />
      {error && (
        <div className="px-5 pb-4">
          <FormError message={error} />
        </div>
      )}
      {invoices.data?.total === 0 && (
        <p className="px-5 pb-6 text-[13px] text-muted-foreground">Aucun relevé pour l’instant.</p>
      )}
      {invoices.data && invoices.data.total > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Relevé</TableHead>
                <TableHead className="hidden md:table-cell">Période</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Pages</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Marge</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.data.items.map((invoice) => (
                <TableRow
                  key={invoice.id}
                  className={cn(invoice.status === 'CANCELLED' && 'opacity-60')}
                >
                  <TableCell>
                    <button
                      type="button"
                      className="cursor-pointer text-left font-medium hover:underline"
                      onClick={() => setShown(invoice)}
                    >
                      {invoice.number ?? 'Brouillon'}
                    </button>
                    <p className="text-xs text-muted-foreground">{invoice.contract.customerName}</p>
                    <Badge tone={INVOICE_TONES[invoice.status]} className="mt-1">
                      <StatusDot />
                      {INVOICE_STATUS_LABELS[invoice.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {formatDate(invoice.periodStart)} → {formatDate(invoice.periodEnd)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {numberFormat.format(invoice.blackPages)}
                    <p className="text-xs text-muted-foreground">
                      {numberFormat.format(invoice.colorPages)} couleur
                    </p>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {money(invoice.totalAmount, invoice.currency)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'hidden text-right tabular-nums sm:table-cell',
                      (invoice.margin ?? 0) < 0 && 'text-danger',
                    )}
                  >
                    {money(invoice.margin, invoice.currency)}
                  </TableCell>
                  <TableCell>
                    {manage && invoice.status !== 'CANCELLED' && (
                      <div className="flex justify-end gap-1">
                        {invoice.status === 'DRAFT' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={async () => {
                              setError(null);
                              try {
                                await opsApi.issueInvoice(tenantId, invoice.id);
                                await queryClient.invalidateQueries({
                                  queryKey: opsKeys.all(tenantId),
                                });
                              } catch (caught) {
                                setError(errorMessage(caught));
                              }
                            }}
                          >
                            <Send aria-hidden="true" />
                            Émettre
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={
                            invoice.status === 'DRAFT'
                              ? 'Supprimer le brouillon'
                              : 'Annuler le relevé'
                          }
                          onClick={() => setCancelling(invoice)}
                        >
                          <Undo2 aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            pageSize={10}
            total={invoices.data.total}
            onPageChange={setPage}
          />
        </>
      )}
      {shown && <InvoiceDialog invoice={shown} onClose={() => setShown(null)} />}
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title={
          cancelling?.status === 'DRAFT'
            ? 'Supprimer ce brouillon ?'
            : `Annuler le relevé ${cancelling?.number ?? ''} ?`
        }
        description={
          cancelling?.status === 'DRAFT'
            ? 'Le brouillon disparaît ; vous pourrez en établir un autre.'
            : 'Le relevé reste dans l’historique, marqué annulé, avec son numéro.'
        }
        confirmLabel={cancelling?.status === 'DRAFT' ? 'Supprimer' : 'Annuler le relevé'}
        onConfirm={async () => {
          if (!cancelling) return;
          await opsApi.cancelInvoice(tenantId, cancelling.id);
          setCancelling(null);
          await queryClient.invalidateQueries({ queryKey: opsKeys.all(tenantId) });
        }}
      />
    </Panel>
  );
}

function ContractsView({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const manage = can('contracts:manage');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ contract: Contract | null } | null>(null);
  const [assigning, setAssigning] = useState<Contract | null>(null);
  const [billing, setBilling] = useState<Contract | null>(null);
  const contracts = useQuery({
    queryKey: opsKeys.key(tenantId, 'contracts', { search, page }),
    queryFn: () => opsApi.contracts(tenantId, { search, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  return (
    <>
      <Panel>
        <PanelHeader
          title="Contrats clients"
          description="Contrats au coût copie : forfait, pages incluses et pages supplémentaires"
          actions={
            <div className="flex flex-wrap gap-2">
              <SearchInput
                label="Rechercher un contrat"
                placeholder="Référence, client"
                onSearch={onSearch}
              />
              {manage && (
                <Button onClick={() => setEditing({ contract: null })}>
                  <Plus aria-hidden="true" />
                  Nouveau contrat
                </Button>
              )}
            </div>
          }
        />
        {contracts.isPending && <Skeleton className="mx-5 mb-5 h-32" />}
        {contracts.data?.total === 0 && (
          <EmptyState
            icon={FileSignature}
            title="Aucun contrat"
            description="Créez un contrat client, puis rattachez-y ses machines : les relevés de facturation s’établissent sur leurs compteurs."
          />
        )}
        {contracts.data && contracts.data.total > 0 && (
          <>
            <ul className="divide-y divide-border border-t border-border">
              {contracts.data.items.map((contract) => (
                <li
                  key={contract.id}
                  className="flex flex-wrap items-start justify-between gap-4 px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={contract.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        <StatusDot />
                        {CONTRACT_STATUS_LABELS[contract.status]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Facturation {BILLING_PERIOD_LABELS[contract.billingPeriod].toLowerCase()}
                      </span>
                    </div>
                    <p className="mt-1.5 font-medium">
                      {contract.customerName}{' '}
                      <span className="text-muted-foreground">· {contract.reference}</span>
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      {money(contract.fixedFee, contract.currency, 0)} par période,{' '}
                      {numberFormat.format(contract.includedBlackPages)} N&B et{' '}
                      {numberFormat.format(contract.includedColorPages)} couleur incluses, puis{' '}
                      {pageCost(contract.blackPagePrice, contract.currency)} et{' '}
                      {pageCost(contract.colorPagePrice, contract.currency)} la page
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {contract.printers.length} machine(s) · depuis le{' '}
                      {formatDate(contract.startDate)}
                      {contract.endDate && ` jusqu’au ${formatDate(contract.endDate)}`}
                      {contract.lastInvoice &&
                        ` · dernier relevé au ${formatDate(contract.lastInvoice.periodEnd)}`}
                    </p>
                  </div>
                  {manage && (
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!contract.printers.length}
                        onClick={() => setBilling(contract)}
                      >
                        <FilePlus2 aria-hidden="true" />
                        Établir un relevé
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setAssigning(contract)}>
                        <Printer aria-hidden="true" />
                        Machines
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Modifier ${contract.reference}`}
                        onClick={() => setEditing({ contract })}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={20}
              total={contracts.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Panel>
      <Invoices tenantId={tenantId} />
      {editing && (
        <ContractDialog
          tenantId={tenantId}
          contract={editing.contract}
          onClose={() => setEditing(null)}
        />
      )}
      {assigning && (
        <PrintersDialog
          tenantId={tenantId}
          contract={assigning}
          onClose={() => setAssigning(null)}
        />
      )}
      {billing && (
        <NewInvoiceDialog tenantId={tenantId} contract={billing} onClose={() => setBilling(null)} />
      )}
    </>
  );
}

export function ContractsPage() {
  const { tenantId, tenantName } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Contrats"
        description={
          tenantName
            ? `Contrats clients et facturation de ${tenantName}.`
            : 'Contrats clients et facturation.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? <ContractsView key={tenantId} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
