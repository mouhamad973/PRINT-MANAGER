'use client';

import { PRINTER_STATUS_LABELS, PRINTER_STATUSES, type PrinterDetail } from '@arksen/shared-types';
import { printerCreateSchema, type PrinterCreateInput } from '@arksen/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { describedBy, Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, errorMessage } from '@/lib/api';
import { fleetApi, fleetKeys } from './api';

type Values = z.input<typeof printerCreateSchema>;

function toValues(printer: PrinterDetail | null, defaultSiteId = ''): Values {
  return {
    siteId: printer?.site.id ?? defaultSiteId,
    modelId: printer?.model.id ?? '',
    name: printer?.name ?? '',
    serialNumber: printer?.serialNumber ?? '',
    assetTag: printer?.assetTag ?? '',
    location: printer?.location ?? '',
    status: printer?.status ?? 'ACTIVE',
    installedAt: printer?.installedAt ?? '',
    notes: printer?.notes ?? '',
  };
}

interface PrinterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  printer: PrinterDetail | null;
  defaultSiteId?: string;
  onSubmit: (values: PrinterCreateInput) => Promise<unknown>;
}

/** Ajout ou modification d'une machine : identification, rattachement et statut. */
export function PrinterDialog({
  open,
  onOpenChange,
  tenantId,
  printer,
  defaultSiteId,
  onSubmit,
}: PrinterDialogProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const sites = useQuery({
    queryKey: fleetKeys.sites(tenantId, { all: true }),
    queryFn: () => fleetApi.allSites(tenantId),
    enabled: open,
  });
  const models = useQuery({
    queryKey: fleetKeys.models(tenantId, { all: true }),
    queryFn: () => fleetApi.models(tenantId, { pageSize: 100 }),
    enabled: open,
  });
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values, unknown, PrinterCreateInput>({
    resolver: zodResolver(printerCreateSchema),
    defaultValues: toValues(printer, defaultSiteId),
  });

  useEffect(() => {
    if (open) {
      reset(toValues(printer, defaultSiteId));
    }
  }, [open, printer, defaultSiteId, reset]);

  async function submit(values: PrinterCreateInput) {
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setError('serialNumber', { message: error.message });
        return;
      }
      setFormError(errorMessage(error));
    }
  }

  const field = (name: keyof Values) => {
    const id = `printer-${name}`;
    return {
      id,
      'aria-invalid': Boolean(errors[name]),
      'aria-describedby': describedBy(id, errors[name]?.message),
      ...register(name),
    };
  };

  const noSites = sites.data?.total === 0;
  const noModels = models.data?.total === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFormError(null);
        onOpenChange(next);
      }}
      title={printer ? `Modifier ${printer.name}` : 'Nouvelle machine'}
      description="La configuration réseau se renseigne ensuite, depuis la fiche de la machine."
      className="max-w-2xl"
    >
      <form noValidate className="grid gap-4" onSubmit={handleSubmit(submit)}>
        <FormError message={formError} />
        {(noSites || noModels) && (
          <FormError
            message={
              noSites
                ? 'Créez d’abord un site : chaque machine y est rattachée.'
                : 'Aucune fiche technique n’est disponible. Créez d’abord celle du modèle.'
            }
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="printer-name"
            label="Nom de la machine"
            hint="Ex. Accueil RDC"
            error={errors.name?.message}
          >
            <Input autoComplete="off" {...field('name')} />
          </Field>
          <Field
            id="printer-serialNumber"
            label="Numéro de série"
            error={errors.serialNumber?.message}
          >
            <Input autoComplete="off" spellCheck={false} {...field('serialNumber')} />
          </Field>
          <Field id="printer-siteId" label="Site" error={errors.siteId?.message}>
            <Select disabled={sites.isPending} {...field('siteId')}>
              <option value="">Choisir un site…</option>
              {sites.data?.items.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="printer-modelId" label="Modèle" error={errors.modelId?.message}>
            <Select disabled={models.isPending} {...field('modelId')}>
              <option value="">Choisir un modèle…</option>
              {models.data?.items.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.manufacturer} {model.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="printer-location"
            label="Emplacement"
            hint="Étage, bureau"
            error={errors.location?.message}
          >
            <Input autoComplete="off" {...field('location')} />
          </Field>
          <Field
            id="printer-assetTag"
            label="Numéro d’inventaire"
            hint="Facultatif"
            error={errors.assetTag?.message}
          >
            <Input autoComplete="off" {...field('assetTag')} />
          </Field>
          <Field id="printer-status" label="Statut" error={errors.status?.message}>
            <Select {...field('status')}>
              {PRINTER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {PRINTER_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="printer-installedAt"
            label="Date d’installation"
            error={errors.installedAt?.message}
          >
            <Input type="date" {...field('installedAt')} />
          </Field>
        </div>
        <Field id="printer-notes" label="Notes" error={errors.notes?.message}>
          <Textarea {...field('notes')} />
        </Field>
        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button type="submit" disabled={isSubmitting || noSites || noModels}>
            {isSubmitting ? 'Enregistrement…' : printer ? 'Enregistrer' : 'Ajouter la machine'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
