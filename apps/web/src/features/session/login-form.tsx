'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { signInSchema, type SignInInput } from '@arksen/validation';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { describedBy, Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, authFetch } from '@/lib/api';
import { safeRedirect } from '@/lib/safe-redirect';

function signInMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Adresse e-mail ou mot de passe incorrect.';
    if (error.status === 403) return 'Ce compte est désactivé. Contactez votre administrateur.';
    if (error.status === 429) return 'Trop de tentatives. Patientez une minute avant de réessayer.';
  }
  return 'Connexion impossible pour le moment. Réessayez dans un instant.';
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const disabled = searchParams.get('reason') === 'disabled';
  const [formError, setFormError] = useState<string | null>(
    disabled ? 'Ce compte est désactivé. Contactez votre administrateur.' : null,
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({ resolver: zodResolver(signInSchema) });

  // Un compte désactivé garde un cookie devenu inutile : on le retire.
  useEffect(() => {
    if (disabled) {
      void authFetch('/sign-out', {}).catch(() => undefined);
    }
  }, [disabled]);

  async function onSubmit(values: SignInInput) {
    setFormError(null);
    try {
      await authFetch('/sign-in/email', { ...values, rememberMe: false });
      queryClient.clear();
      router.replace(safeRedirect(searchParams.get('next')));
    } catch (error) {
      setFormError(signInMessage(error));
    }
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormError message={formError} />
      <Field id="email" label="Adresse e-mail" error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          autoFocus
          aria-invalid={Boolean(errors.email)}
          aria-describedby={describedBy('email', errors.email?.message)}
          {...register('email')}
        />
      </Field>
      <Field id="password" label="Mot de passe" error={errors.password?.message}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(errors.password)}
          aria-describedby={describedBy('password', errors.password?.message)}
          {...register('password')}
        />
      </Field>
      <Button type="submit" disabled={isSubmitting} className="mt-1">
        {isSubmitting ? 'Connexion…' : 'Se connecter'}
      </Button>
    </form>
  );
}
