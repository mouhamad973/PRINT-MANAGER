'use client';

import {
  COLOR_MODE_LABELS,
  COLOR_MODES,
  PAPER_FORMATS,
  PRINT_TECHNOLOGIES,
  PRINT_TECHNOLOGY_LABELS,
  type PrinterModel,
} from '@arksen/shared-types';
import { printerModelCreateSchema, type PrinterModelCreateInput } from '@arksen/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { describedBy, Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, errorMessage } from '@/lib/api';

type Values = z.input<typeof printerModelCreateSchema>;

function toValues(model: PrinterModel | null): Values {
  return {
    manufacturer: model?.manufacturer ?? '',
    name: model?.name ?? '',
    colorMode: model?.colorMode ?? 'COLOR',
    technology: model?.technology ?? 'LASER',
    maxFormat: model?.maxFormat ?? 'A4',
    speedMonoPpm: model?.speedMonoPpm ?? '',
    speedColorPpm: model?.speedColorPpm ?? '',
    duplex: model?.duplex ?? true,
    monthlyDutyCycle: model?.monthlyDutyCycle ?? '',
    recommendedVolume: model?.recommendedVolume ?? '',
    notes: model?.notes ?? '',
  };
}

interface ModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: PrinterModel | null;
  /** Où la fiche sera rangée, pour le dire à l'utilisateur. */
  scopeLabel: string;
  onSubmit: (values: PrinterModelCreateInput) => Promise<unknown>;
}

export function ModelDialog({ open, onOpenChange, model, scopeLabel, onSubmit }: ModelDialogProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values, unknown, PrinterModelCreateInput>({
    resolver: zodResolver(printerModelCreateSchema),
    defaultValues: toValues(model),
  });
  const monochrome = useWatch({ control, name: 'colorMode' }) === 'MONOCHROME';

  useEffect(() => {
    if (open) {
      reset(toValues(model));
    }
  }, [open, model, reset]);

  useEffect(() => {
    if (monochrome) setValue('speedColorPpm', '');
  }, [monochrome, setValue]);

  async function submit(values: PrinterModelCreateInput) {
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setError('name', { message: error.message });
        return;
      }
      setFormError(errorMessage(error));
    }
  }

  const field = (name: keyof Values, id = `model-${name}`) => ({
    id,
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': describedBy(id, errors[name]?.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFormError(null);
        onOpenChange(next);
      }}
      title={model ? `Modifier ${model.manufacturer} ${model.name}` : 'Nouvelle fiche technique'}
      description={`Caractéristiques d’un modèle d’imprimante, enregistrées dans ${scopeLabel}.`}
      className="max-w-2xl"
    >
      <form noValidate className="grid gap-4" onSubmit={handleSubmit(submit)}>
        <FormError message={formError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="model-manufacturer" label="Fabricant" error={errors.manufacturer?.message}>
            <Input autoComplete="off" {...field('manufacturer')} {...register('manufacturer')} />
          </Field>
          <Field id="model-name" label="Modèle" error={errors.name?.message}>
            <Input autoComplete="off" {...field('name')} {...register('name')} />
          </Field>
          <Field id="model-colorMode" label="Impression" error={errors.colorMode?.message}>
            <Select {...field('colorMode')} {...register('colorMode')}>
              {COLOR_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {COLOR_MODE_LABELS[mode]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="model-technology" label="Technologie" error={errors.technology?.message}>
            <Select {...field('technology')} {...register('technology')}>
              {PRINT_TECHNOLOGIES.map((technology) => (
                <option key={technology} value={technology}>
                  {PRINT_TECHNOLOGY_LABELS[technology]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="model-maxFormat" label="Format maximal" error={errors.maxFormat?.message}>
            <Select {...field('maxFormat')} {...register('maxFormat')}>
              {PAPER_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {format}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex h-10 cursor-pointer items-center gap-3 self-end text-sm font-medium">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              {...register('duplex')}
            />
            Recto verso automatique
          </label>
          <Field
            id="model-speedMonoPpm"
            label="Vitesse noir et blanc"
            hint="Pages par minute, A4"
            error={errors.speedMonoPpm?.message}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              {...field('speedMonoPpm')}
              {...register('speedMonoPpm')}
            />
          </Field>
          <Field
            id="model-speedColorPpm"
            label="Vitesse couleur"
            hint={monochrome ? 'Sans objet en noir et blanc' : 'Pages par minute, A4'}
            error={errors.speedColorPpm?.message}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              disabled={monochrome}
              {...field('speedColorPpm')}
              {...register('speedColorPpm')}
            />
          </Field>
          <Field
            id="model-monthlyDutyCycle"
            label="Volume mensuel maximal"
            hint="Pages par mois, selon le constructeur"
            error={errors.monthlyDutyCycle?.message}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              {...field('monthlyDutyCycle')}
              {...register('monthlyDutyCycle')}
            />
          </Field>
          <Field
            id="model-recommendedVolume"
            label="Volume mensuel recommandé"
            hint="Pages par mois"
            error={errors.recommendedVolume?.message}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              {...field('recommendedVolume')}
              {...register('recommendedVolume')}
            />
          </Field>
        </div>
        <Field id="model-notes" label="Notes" error={errors.notes?.message}>
          <Textarea {...field('notes')} {...register('notes')} />
        </Field>
        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Enregistrement…' : model ? 'Enregistrer' : 'Créer la fiche'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
