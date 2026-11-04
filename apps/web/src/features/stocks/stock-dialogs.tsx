'use client';

import type { TonerStock } from '@arksen/shared-types';
import {
  stockCreateSchema,
  stockMovementCreateSchema,
  stockTransferSchema,
  stockUpdateSchema,
} from '@arksen/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { fleetApi, fleetKeys } from '@/features/fleet/api';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { stockApi, stockKeys } from './api';

/** Premier message d'erreur d'une validation : le formulaire l'affiche tel quel. */
function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Saisie invalide.';
}

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  /** Rend une erreur à afficher, ou rien si l'envoi a réussi. */
  onSubmit: () => Promise<string | null>;
  children: ReactNode;
}

function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  onSubmit,
  children,
}: FormDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const problem = await onSubmit();
      if (problem) setError(problem);
      else onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
      title={title}
      description={description}
    >
      <form noValidate className="grid gap-4" onSubmit={submit}>
        <FormError message={error} />
        {children}
        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Enregistrement…' : submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function useRefresh(tenantId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: stockKeys.all(tenantId) });
}

export function NewStockDialog({
  tenantId,
  open,
  onOpenChange,
}: {
  tenantId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefresh(tenantId);
  const [values, setValues] = useState({
    siteId: '',
    reference: '',
    minQuantity: '2',
    leadTimeDays: '7',
  });
  const sites = useQuery({
    queryKey: fleetKeys.sites(tenantId, { all: true }),
    queryFn: () => fleetApi.allSites(tenantId),
    enabled: open,
  });
  const references = useQuery({
    queryKey: stockKeys.references(tenantId),
    queryFn: () => stockApi.references(tenantId),
    enabled: open,
  });
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Suivre une référence"
      description="Une référence de cartouche sur un site : son stock, son seuil et son délai de réapprovisionnement."
      submitLabel="Créer l’article"
      onSubmit={async () => {
        const parsed = stockCreateSchema.safeParse(values);
        if (!parsed.success) return firstIssue(parsed.error);
        await stockApi.createStock(tenantId, parsed.data);
        await refresh();
        setValues({ siteId: '', reference: '', minQuantity: '2', leadTimeDays: '7' });
        return null;
      }}
    >
      <Field id="stock-site" label="Site">
        <Select
          id="stock-site"
          value={values.siteId}
          onChange={(e) => set('siteId')(e.target.value)}
        >
          <option value="">Choisir un site…</option>
          {sites.data?.items.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        id="stock-reference"
        label="Référence"
        hint="Les références viennent des fiches techniques : renseignez-y d’abord les toners."
      >
        <Select
          id="stock-reference"
          value={values.reference}
          onChange={(e) => set('reference')(e.target.value)}
        >
          <option value="">Choisir une référence…</option>
          {references.data?.map((reference) => (
            <option key={reference.reference} value={reference.reference}>
              {reference.reference} · {reference.models.map((model) => model.name).join(', ')}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="stock-min" label="Seuil minimum" hint="Cartouches ; 0 : pas d’alerte">
          <Input
            id="stock-min"
            inputMode="numeric"
            value={values.minQuantity}
            onChange={(e) => set('minQuantity')(e.target.value)}
          />
        </Field>
        <Field id="stock-lead" label="Délai de réapprovisionnement" hint="Jours">
          <Input
            id="stock-lead"
            inputMode="numeric"
            value={values.leadTimeDays}
            onChange={(e) => set('leadTimeDays')(e.target.value)}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

export function ThresholdDialog({
  tenantId,
  stock,
  onClose,
}: {
  tenantId: string;
  stock: TonerStock | null;
  onClose: () => void;
}) {
  const refresh = useRefresh(tenantId);
  const [min, setMin] = useState('');
  const [lead, setLead] = useState('');
  return (
    <FormDialog
      open={stock !== null}
      onOpenChange={(open) => {
        if (!open) {
          setMin('');
          setLead('');
          onClose();
        }
      }}
      title={stock ? `Seuils de ${stock.reference} à ${stock.site.name}` : ''}
      submitLabel="Enregistrer"
      onSubmit={async () => {
        if (!stock) return null;
        const parsed = stockUpdateSchema.safeParse({
          minQuantity: min === '' ? stock.minQuantity : min,
          leadTimeDays: lead === '' ? stock.leadTimeDays : lead,
        });
        if (!parsed.success) return firstIssue(parsed.error);
        await stockApi.updateStock(tenantId, stock.id, parsed.data);
        await refresh();
        return null;
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="threshold-min" label="Seuil minimum" hint="Alerte à ce niveau ou en dessous">
          <Input
            id="threshold-min"
            inputMode="numeric"
            placeholder={String(stock?.minQuantity ?? '')}
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
        </Field>
        <Field id="threshold-lead" label="Délai de réapprovisionnement" hint="Jours">
          <Input
            id="threshold-lead"
            inputMode="numeric"
            placeholder={String(stock?.leadTimeDays ?? '')}
            value={lead}
            onChange={(e) => setLead(e.target.value)}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

const MOVEMENT_CHOICES = [
  { type: 'RECEIPT', label: 'Réception', hint: 'Cartouches livrées' },
  { type: 'ISSUE', label: 'Sortie', hint: 'Remise, retour fournisseur, casse' },
  { type: 'ADJUSTMENT', label: 'Inventaire', hint: 'Quantité réellement comptée' },
] as const;

export function MovementDialog({
  tenantId,
  stock,
  onClose,
}: {
  tenantId: string;
  stock: TonerStock | null;
  onClose: () => void;
}) {
  const refresh = useRefresh(tenantId);
  const empty = { type: 'RECEIPT', quantity: '', unitCost: '', reference: '', notes: '' };
  const [values, setValues] = useState<Record<string, string>>(empty);
  const set = (key: string) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const type = values.type as (typeof MOVEMENT_CHOICES)[number]['type'];

  return (
    <FormDialog
      open={stock !== null}
      onOpenChange={(open) => {
        if (!open) {
          setValues(empty);
          onClose();
        }
      }}
      title={stock ? `${stock.reference} à ${stock.site.name}` : ''}
      description={stock ? `${stock.quantity} cartouche(s) en stock.` : undefined}
      submitLabel="Enregistrer le mouvement"
      onSubmit={async () => {
        if (!stock) return null;
        const input =
          type === 'ADJUSTMENT'
            ? { type, countedQuantity: values.quantity, notes: values.notes }
            : type === 'RECEIPT'
              ? {
                  type,
                  quantity: values.quantity,
                  unitCost: values.unitCost,
                  reference: values.reference,
                  notes: values.notes,
                }
              : {
                  type,
                  quantity: values.quantity,
                  reference: values.reference,
                  notes: values.notes,
                };
        const parsed = stockMovementCreateSchema.safeParse(input);
        if (!parsed.success) return firstIssue(parsed.error);
        await stockApi.createMovement(tenantId, stock.id, parsed.data);
        await refresh();
        setValues(empty);
        return null;
      }}
    >
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-medium">Mouvement</legend>
        {MOVEMENT_CHOICES.map((choice) => (
          <label
            key={choice.type}
            className={cn(
              'cursor-pointer rounded-lg border px-3 py-2.5 text-sm transition-colors',
              type === choice.type
                ? 'border-primary bg-primary-soft text-primary-soft-foreground'
                : 'border-border hover:bg-muted',
            )}
          >
            <input
              type="radio"
              name="movement-type"
              className="sr-only"
              checked={type === choice.type}
              onChange={() => set('type')(choice.type)}
            />
            <span className="font-medium">{choice.label}</span>
            <span className="block text-xs text-muted-foreground">{choice.hint}</span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="movement-quantity"
          label={type === 'ADJUSTMENT' ? 'Quantité comptée' : 'Quantité'}
          hint={type === 'ADJUSTMENT' ? 'L’écart avec le stock devient un mouvement' : 'Cartouches'}
        >
          <Input
            id="movement-quantity"
            inputMode="numeric"
            value={values.quantity}
            onChange={(e) => set('quantity')(e.target.value)}
          />
        </Field>
        {type === 'RECEIPT' && (
          <Field
            id="movement-cost"
            label="Coût unitaire"
            hint={`Facultatif, en ${stock?.currency ?? ''}`}
          >
            <Input
              id="movement-cost"
              inputMode="decimal"
              value={values.unitCost}
              onChange={(e) => set('unitCost')(e.target.value)}
            />
          </Field>
        )}
        {type !== 'ADJUSTMENT' && (
          <Field
            id="movement-reference"
            label={type === 'RECEIPT' ? 'Bon de livraison' : 'Bon de sortie'}
            hint="Facultatif"
          >
            <Input
              id="movement-reference"
              value={values.reference}
              onChange={(e) => set('reference')(e.target.value)}
            />
          </Field>
        )}
      </div>
      <Field id="movement-notes" label="Notes">
        <Textarea
          id="movement-notes"
          value={values.notes}
          onChange={(e) => set('notes')(e.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

export function TransferDialog({
  tenantId,
  stock,
  onClose,
}: {
  tenantId: string;
  stock: TonerStock | null;
  onClose: () => void;
}) {
  const refresh = useRefresh(tenantId);
  const [toSiteId, setToSiteId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const sites = useQuery({
    queryKey: fleetKeys.sites(tenantId, { all: true }),
    queryFn: () => fleetApi.allSites(tenantId),
    enabled: stock !== null,
  });
  return (
    <FormDialog
      open={stock !== null}
      onOpenChange={(open) => {
        if (!open) {
          setToSiteId('');
          setQuantity('');
          setNotes('');
          onClose();
        }
      }}
      title={stock ? `Transférer ${stock.reference}` : ''}
      description={
        stock
          ? `Depuis ${stock.site.name}, où ${stock.quantity} cartouche(s) sont en stock.`
          : undefined
      }
      submitLabel="Transférer"
      onSubmit={async () => {
        if (!stock) return null;
        const parsed = stockTransferSchema.safeParse({
          fromStockId: stock.id,
          toSiteId,
          quantity,
          notes,
        });
        if (!parsed.success) return firstIssue(parsed.error);
        await stockApi.transfer(tenantId, parsed.data);
        await refresh();
        return null;
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field id="transfer-site" label="Site de destination">
          <Select id="transfer-site" value={toSiteId} onChange={(e) => setToSiteId(e.target.value)}>
            <option value="">Choisir un site…</option>
            {sites.data?.items
              .filter((site) => site.id !== stock?.site.id)
              .map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field id="transfer-quantity" label="Quantité">
          <Input
            id="transfer-quantity"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
      </div>
      <Field id="transfer-notes" label="Notes">
        <Textarea id="transfer-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </FormDialog>
  );
}
