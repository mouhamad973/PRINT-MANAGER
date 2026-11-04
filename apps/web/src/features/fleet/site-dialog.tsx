'use client';

import type { Site } from '@arksen/shared-types';
import { siteCreateSchema, type SiteCreateInput } from '@arksen/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { describedBy, Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, errorMessage } from '@/lib/api';

type Values = z.input<typeof siteCreateSchema>;

const EMPTY: Values = {
  name: '',
  code: '',
  address: '',
  postalCode: '',
  city: '',
  country: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  notes: '',
};

function toValues(site: Site | null): Values {
  if (!site) return EMPTY;
  return Object.fromEntries(
    Object.keys(EMPTY).map((key) => [key, site[key as keyof Site] ?? '']),
  ) as Values;
}

interface SiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Site à modifier, ou `null` pour en créer un. */
  site: Site | null;
  onSubmit: (values: SiteCreateInput) => Promise<unknown>;
}

const TEXT_FIELDS: { name: keyof Values; label: string; autoComplete?: string; type?: string }[] = [
  { name: 'address', label: 'Adresse', autoComplete: 'street-address' },
  { name: 'postalCode', label: 'Code postal', autoComplete: 'postal-code' },
  { name: 'city', label: 'Ville', autoComplete: 'address-level2' },
  { name: 'country', label: 'Pays', autoComplete: 'country-name' },
  { name: 'contactName', label: 'Contact sur place' },
  { name: 'contactEmail', label: 'E-mail du contact', type: 'email' },
  { name: 'contactPhone', label: 'Téléphone du contact', type: 'tel' },
];

export function SiteDialog({ open, onOpenChange, site, onSubmit }: SiteDialogProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values, unknown, SiteCreateInput>({
    resolver: zodResolver(siteCreateSchema),
    defaultValues: toValues(site),
  });

  useEffect(() => {
    if (open) {
      reset(toValues(site));
    }
  }, [open, site, reset]);

  async function submit(values: SiteCreateInput) {
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

  const field = (name: keyof Values) => ({
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': describedBy(`site-${name}`, errors[name]?.message),
    ...register(name),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFormError(null);
        onOpenChange(next);
      }}
      title={site ? `Modifier ${site.name}` : 'Nouveau site'}
      description="Agence, atelier ou étage : chaque machine est rattachée à un site."
      className="max-w-2xl"
    >
      <form noValidate className="grid gap-4" onSubmit={handleSubmit(submit)}>
        <FormError message={formError} />
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Field id="site-name" label="Nom du site" error={errors.name?.message}>
            <Input id="site-name" autoComplete="off" {...field('name')} />
          </Field>
          <Field id="site-code" label="Code interne" error={errors.code?.message} hint="Facultatif">
            <Input id="site-code" autoComplete="off" {...field('code')} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {TEXT_FIELDS.map(({ name, label, autoComplete, type }) => (
            <Field key={name} id={`site-${name}`} label={label} error={errors[name]?.message}>
              <Input
                id={`site-${name}`}
                type={type}
                autoComplete={autoComplete ?? 'off'}
                {...field(name)}
              />
            </Field>
          ))}
        </div>
        <Field id="site-notes" label="Notes" error={errors.notes?.message}>
          <Textarea id="site-notes" {...field('notes')} />
        </Field>
        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Enregistrement…' : site ? 'Enregistrer' : 'Créer le site'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
