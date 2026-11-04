'use client';

import {
  CMYK_LABELS,
  channelsFor,
  type CmykChannel,
  type PrinterModel,
  type TonerSpec,
} from '@arksen/shared-types';
import { tonerSpecSchema } from '@arksen/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { fleetApi, fleetKeys, send } from '@/features/fleet/api';
import { errorMessage } from '@/lib/api';
import { InkLabel } from './consumption-ui';

interface Row {
  reference: string;
  capacityGrams: string;
  yieldPages: string;
  referenceCoverage: string;
  unitPrice: string;
}

const text = (value: number | null | undefined) =>
  value === null || value === undefined ? '' : String(value).replace('.', ',');
const decimal = (value: string) => value.replace(/\s/g, '').replace(',', '.');

function toRow(toner: TonerSpec | undefined): Row {
  return {
    reference: toner?.reference ?? '',
    capacityGrams: text(toner?.capacityGrams),
    yieldPages: text(toner?.yieldPages),
    referenceCoverage: text(toner?.referenceCoverage ?? 5),
    unitPrice: text(toner?.unitPrice),
  };
}

interface TonersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Entreprise dont on gère les prix ; `null` pour le catalogue Arksen (sans prix). */
  tenantId: string | null;
  model: PrinterModel;
  canEditSpecs: boolean;
  canEditPrices: boolean;
  currency: string | null;
}

/** Toners d'une fiche technique : caractéristiques constructeur et prix d'achat de l'entreprise. */
export function TonersDialog({
  open,
  onOpenChange,
  tenantId,
  model,
  canEditSpecs,
  canEditPrices,
  currency,
}: TonersDialogProps) {
  const queryClient = useQueryClient();
  const channels = channelsFor(model.colorMode);
  const toners = useQuery({
    queryKey: fleetKeys.toners(tenantId, model.id),
    queryFn: () => fleetApi.toners(tenantId, model.id),
    enabled: open,
  });
  // Seules les saisies sont gardées en état ; le reste vient des toners chargés.
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const rows: Record<string, Row> = toners.data
    ? Object.fromEntries(
        channels.map((channel) => [
          channel,
          { ...toRow(toners.data.find((item) => item.channel === channel)), ...edits[channel] },
        ]),
      )
    : {};

  const update = (channel: CmykChannel, field: keyof Row, value: string) =>
    setEdits((current) => ({ ...current, [channel]: { ...current[channel], [field]: value } }));

  async function save() {
    setError(null);
    setPending(true);
    const base = `${tenantId ? `/tenants/${tenantId}` : ''}/printer-models/${model.id}/toners`;
    try {
      for (const channel of channels) {
        const row = rows[channel]!;
        const existing = toners.data?.find((item) => item.channel === channel);
        let tonerId = existing?.id;
        const filled = row.reference || row.capacityGrams || row.yieldPages;
        if (canEditSpecs && filled) {
          const parsed = tonerSpecSchema.safeParse({
            reference: row.reference,
            capacityGrams: decimal(row.capacityGrams),
            yieldPages: decimal(row.yieldPages),
            referenceCoverage: decimal(row.referenceCoverage) || 5,
          });
          if (!parsed.success) {
            throw new Error(`${CMYK_LABELS[channel]} : ${parsed.error.issues[0]!.message}`);
          }
          const saved = await send<TonerSpec>('PUT', `${base}/${channel}`, parsed.data);
          tonerId = saved.id;
        }
        if (canEditPrices && tenantId && tonerId) {
          const price = decimal(row.unitPrice);
          if (price !== text(existing?.unitPrice).replace(',', '.') || !existing) {
            await send<void>('PUT', `/tenants/${tenantId}/toners/${tonerId}/price`, {
              unitPrice: price === '' ? null : price,
            });
          }
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['fleet'] });
      setEdits({});
      onOpenChange(false);
    } catch (caught) {
      setError(
        caught instanceof Error && !('status' in caught) ? caught.message : errorMessage(caught),
      );
    } finally {
      setPending(false);
    }
  }

  const editable = canEditSpecs || canEditPrices;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Toners · ${model.manufacturer} ${model.name}`}
      description="Masse et rendement constructeur de chaque cartouche. Le rendement est mesuré à la couverture de référence, 5 % selon ISO/IEC 19752 et 19798."
      className="max-w-3xl"
    >
      <div className="grid gap-5">
        <FormError message={error} />
        {toners.isPending && <Skeleton className="h-40" />}
        {toners.data && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Encre</th>
                  <th className="px-3 py-2 text-left">Référence</th>
                  <th className="px-3 py-2 text-left">Masse (g)</th>
                  <th className="px-3 py-2 text-left">Rendement (pages)</th>
                  <th className="px-3 py-2 text-left">Couv. réf. (%)</th>
                  {tenantId && <th className="px-3 py-2 text-left">Prix ({currency})</th>}
                </tr>
              </thead>
              <tbody>
                {channels.map((channel) => {
                  const row = rows[channel];
                  if (!row) return null;
                  const cell = (field: keyof Row, label: string, enabled: boolean) => (
                    <td className="px-2 py-2">
                      <Input
                        aria-label={`${label} ${CMYK_LABELS[channel]}`}
                        className="h-9 min-w-24"
                        inputMode={field === 'reference' ? 'text' : 'decimal'}
                        disabled={!enabled}
                        value={row[field]}
                        onChange={(event) => update(channel, field, event.target.value)}
                      />
                    </td>
                  );
                  return (
                    <tr key={channel} className="border-t border-border">
                      <td className="px-3 py-2">
                        <InkLabel channel={channel} className="font-medium" />
                      </td>
                      {cell('reference', 'Référence', canEditSpecs)}
                      {cell('capacityGrams', 'Masse', canEditSpecs)}
                      {cell('yieldPages', 'Rendement', canEditSpecs)}
                      {cell('referenceCoverage', 'Couverture de référence', canEditSpecs)}
                      {tenantId && cell('unitPrice', 'Prix', canEditPrices)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!canEditSpecs && (
          <p className="text-[13px] text-muted-foreground">
            {model.tenantId
              ? 'Vos droits ne permettent pas de modifier cette fiche.'
              : 'Fiche du catalogue Arksen : ses toners sont gérés par la plateforme. Vous pouvez saisir vos prix d’achat.'}
          </p>
        )}
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {editable ? 'Annuler' : 'Fermer'}
          </Button>
          {editable && (
            <Button disabled={pending || !toners.data} onClick={save}>
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
