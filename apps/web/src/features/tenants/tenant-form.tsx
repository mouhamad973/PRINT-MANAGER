'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CURRENCIES, type Tenant } from '@arksen/shared-types';
import { tenantCreateSchema } from '@arksen/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { describedBy, Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';

const detailsSchema = tenantCreateSchema.omit({ slug: true });
type CreateValues = z.input<typeof tenantCreateSchema>;
type CreateOutput = z.output<typeof tenantCreateSchema>;

/** Identifiant dérivé du nom : « Imprimerie du Port » → « imprimerie-du-port ». */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const CONTACT_FIELDS = [
  { name: 'contactName', label: 'Contact principal', autoComplete: 'name' },
  { name: 'contactEmail', label: 'E-mail du contact', autoComplete: 'email', type: 'email' },
  { name: 'contactPhone', label: 'Téléphone', autoComplete: 'tel', type: 'tel' },
  { name: 'address', label: 'Adresse', autoComplete: 'street-address' },
  { name: 'city', label: 'Ville', autoComplete: 'address-level2' },
  { name: 'country', label: 'Pays', autoComplete: 'country-name' },
] as const;

interface TenantFormProps {
  /** Absente : création. Présente : modification des coordonnées. */
  tenant?: Tenant;
  submitLabel: string;
  disabled?: boolean;
  onSubmit: (values: CreateOutput) => Promise<void>;
}

export function TenantForm({ tenant, submitLabel, disabled, onSubmit }: TenantFormProps) {
  const isCreation = !tenant;
  const [formError, setFormError] = useState<string | null>(null);
  const [slugEdited, setSlugEdited] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CreateValues, unknown, CreateOutput>({
    // En modification, l'identifiant n'est ni affiché ni envoyé.
    resolver: zodResolver(isCreation ? tenantCreateSchema : (detailsSchema as never)),
    defaultValues: {
      name: tenant?.name ?? '',
      slug: tenant?.slug ?? '',
      contactName: tenant?.contactName ?? '',
      contactEmail: tenant?.contactEmail ?? '',
      contactPhone: tenant?.contactPhone ?? '',
      address: tenant?.address ?? '',
      city: tenant?.city ?? '',
      country: tenant?.country ?? '',
      currency: (tenant?.currency as CreateValues['currency']) ?? 'XOF',
    },
  });

  const nameField = register('name', {
    onChange: (event: { target: { value: string } }) => {
      if (isCreation && !slugEdited) {
        setValue('slug', slugify(event.target.value), { shouldValidate: Boolean(errors.slug) });
      }
    },
  });

  async function submit(values: CreateOutput) {
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setError('slug', { message: error.message });
        return;
      }
      setFormError(error instanceof ApiError ? error.message : 'Enregistrement impossible.');
    }
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(submit)}>
      <FormError message={formError} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="tenant-name" label="Nom de l’entreprise" error={errors.name?.message}>
          <Input
            id="tenant-name"
            disabled={disabled}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={describedBy('tenant-name', errors.name?.message)}
            {...nameField}
          />
        </Field>
        {isCreation && (
          <Field
            id="tenant-slug"
            label="Identifiant"
            error={errors.slug?.message}
            hint="Unique et définitif. Minuscules, chiffres et tirets."
          >
            <Input
              id="tenant-slug"
              aria-invalid={Boolean(errors.slug)}
              aria-describedby={describedBy(
                'tenant-slug',
                errors.slug?.message,
                'Unique et définitif. Minuscules, chiffres et tirets.',
              )}
              {...register('slug', { onChange: () => setSlugEdited(true) })}
            />
          </Field>
        )}
        {CONTACT_FIELDS.map((field) => {
          const id = `tenant-${field.name}`;
          const message = errors[field.name]?.message;
          return (
            <Field key={field.name} id={id} label={field.label} error={message}>
              <Input
                id={id}
                type={'type' in field ? field.type : 'text'}
                autoComplete={field.autoComplete}
                disabled={disabled}
                aria-invalid={Boolean(message)}
                aria-describedby={describedBy(id, message)}
                {...register(field.name)}
              />
            </Field>
          );
        })}
        <Field
          id="tenant-currency"
          label="Devise"
          error={errors.currency?.message}
          hint="Prix des toners et coûts d’impression"
        >
          <Select id="tenant-currency" disabled={disabled} {...register('currency')}>
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {!disabled && (
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting || (!isCreation && !isDirty)}>
            {isSubmitting ? 'Enregistrement…' : submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
