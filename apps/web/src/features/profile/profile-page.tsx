'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ROLE_LABELS, type CurrentUser } from '@arksen/shared-types';
import { changePasswordSchema, profileUpdateSchema } from '@arksen/validation';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { PageHeader } from '@/components/layout/page-header';
import { initials } from '@/components/layout/user-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { describedBy, Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { ME_QUERY_KEY, useSession } from '@/features/session/session-provider';
import { ApiError, apiFetch, authFetch } from '@/lib/api';

function Success({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="text-[13px] text-success">
      {message}
    </p>
  );
}

function NameForm() {
  const { current } = useSession();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<z.input<typeof profileUpdateSchema>, unknown, z.output<typeof profileUpdateSchema>>({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: { name: current.user.name },
  });

  async function submit(values: { name: string }) {
    setStatus({});
    try {
      const updated = await apiFetch<CurrentUser>('/me', {
        method: 'PATCH',
        body: JSON.stringify(values),
      });
      queryClient.setQueryData(ME_QUERY_KEY, updated);
      reset({ name: updated.user.name });
      setStatus({ ok: 'Nom enregistré.' });
    } catch (error) {
      setStatus({
        error: error instanceof ApiError ? error.message : 'Enregistrement impossible.',
      });
    }
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(submit)}>
      <FormError message={status.error} />
      <Field id="profile-name" label="Nom complet" error={errors.name?.message}>
        <Input
          id="profile-name"
          autoComplete="name"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={describedBy('profile-name', errors.name?.message)}
          {...register('name')}
        />
      </Field>
      <div className="flex items-center justify-end gap-3">
        <Success message={status.ok ?? null} />
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}

type PasswordValues = z.input<typeof changePasswordSchema>;

function PasswordForm() {
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({ resolver: zodResolver(changePasswordSchema) });

  async function submit(values: PasswordValues) {
    setStatus({});
    try {
      await authFetch('/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        // Les autres appareils sont déconnectés : un mot de passe compromis ne laisse rien ouvert.
        revokeOtherSessions: true,
      });
      reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setStatus({ ok: 'Mot de passe modifié. Vos autres sessions ont été fermées.' });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 400 || error.status === 401)) {
        setError('currentPassword', { message: 'Mot de passe actuel incorrect.' });
        return;
      }
      setStatus({ error: error instanceof ApiError ? error.message : 'Modification impossible.' });
    }
  }

  const fields = [
    { name: 'currentPassword', label: 'Mot de passe actuel', autoComplete: 'current-password' },
    {
      name: 'newPassword',
      label: 'Nouveau mot de passe',
      autoComplete: 'new-password',
      hint: '12 caractères minimum. Une phrase de passe est plus sûre et plus facile à retenir.',
    },
    { name: 'confirmPassword', label: 'Confirmation', autoComplete: 'new-password' },
  ] as const;

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(submit)}>
      <FormError message={status.error} />
      {fields.map((field) => {
        const id = `password-${field.name}`;
        const message = errors[field.name]?.message;
        const hint = 'hint' in field ? field.hint : undefined;
        return (
          <Field key={field.name} id={id} label={field.label} error={message} hint={hint}>
            <Input
              id={id}
              type="password"
              autoComplete={field.autoComplete}
              aria-invalid={Boolean(message)}
              aria-describedby={describedBy(id, message, hint)}
              {...register(field.name)}
            />
          </Field>
        );
      })}
      <div className="flex items-center justify-end gap-3">
        <Success message={status.ok ?? null} />
        <Button type="submit" disabled={isSubmitting}>
          Modifier le mot de passe
        </Button>
      </div>
    </form>
  );
}

export function ProfilePage() {
  const { current } = useSession();
  const { user, tenant } = current;

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader title="Mon profil" />

      <Panel className="p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary-soft text-lg font-semibold text-primary-soft-foreground">
            {initials(user.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold tracking-[-0.015em]">{user.name}</p>
            <p className="truncate text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <dl className="mt-5 grid gap-x-8 gap-y-4 border-t border-border/80 pt-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Rôle</dt>
            <dd className="mt-1">
              <Badge tone="brand">{ROLE_LABELS[user.role]}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Entreprise</dt>
            <dd className="mt-1 font-medium">{tenant?.name ?? 'Plateforme Arksen'}</dd>
          </div>
        </dl>
        <p className="mt-5 text-xs text-muted-foreground">
          L’adresse, le rôle et l’entreprise sont gérés par votre administrateur.
        </p>
      </Panel>

      <section className="space-y-3" aria-labelledby="identity-title">
        <h2 id="identity-title" className="text-lg font-semibold tracking-[-0.015em]">
          Identité
        </h2>
        <Panel className="p-5 sm:p-6">
          <NameForm />
        </Panel>
      </section>

      <section className="space-y-3" aria-labelledby="password-title">
        <h2 id="password-title" className="text-lg font-semibold tracking-[-0.015em]">
          Mot de passe
        </h2>
        <Panel className="p-5 sm:p-6">
          <PasswordForm />
        </Panel>
      </section>
    </div>
  );
}
