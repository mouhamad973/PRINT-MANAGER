'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ROLE_LABELS, TENANT_ROLES, type UserAccount } from '@arksen/shared-types';
import {
  passwordResetSchema,
  userCreateSchema,
  userUpdateSchema,
  type UserCreateInput,
} from '@arksen/validation';
import { Copy, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { describedBy, Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { generatePassword } from '@/lib/password';

const TEMPORARY_PASSWORD_HINT =
  'Communiquez-le à l’utilisateur par un canal sûr. Il pourra le changer depuis son profil.';

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Enregistrement impossible.';
}

function TemporaryPasswordField({
  id,
  error,
  registration,
  onGenerate,
  getValue,
}: {
  id: string;
  error?: string;
  registration: UseFormRegisterReturn;
  onGenerate: () => void;
  getValue: () => string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Field id={id} label="Mot de passe provisoire" error={error} hint={TEMPORARY_PASSWORD_HINT}>
      <div className="flex gap-2">
        <Input
          id={id}
          autoComplete="new-password"
          spellCheck={false}
          className="font-mono"
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy(id, error, TEMPORARY_PASSWORD_HINT)}
          {...registration}
        />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Générer un mot de passe"
          title="Générer un mot de passe"
          onClick={() => {
            onGenerate();
            setCopied(false);
          }}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={copied ? 'Mot de passe copié' : 'Copier le mot de passe'}
          title={copied ? 'Copié' : 'Copier'}
          onClick={() => {
            const value = getValue();
            if (value) {
              void navigator.clipboard?.writeText(value).then(() => setCopied(true));
            }
          }}
        >
          <Copy aria-hidden="true" />
        </Button>
      </div>
    </Field>
  );
}

export function CreateUserDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: UserCreateInput) => Promise<void>;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof userCreateSchema>, unknown, UserCreateInput>({
    resolver: zodResolver(userCreateSchema),
    defaultValues: { name: '', email: '', role: 'USER', password: generatePassword() },
  });

  async function submit(values: UserCreateInput) {
    setFormError(null);
    try {
      await onSubmit(values);
      reset({ name: '', email: '', role: 'USER', password: generatePassword() });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setError('email', { message: error.message });
        return;
      }
      setFormError(errorMessage(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Nouvel utilisateur">
      <form noValidate className="grid gap-4" onSubmit={handleSubmit(submit)}>
        <FormError message={formError} />
        <Field id="user-name" label="Nom complet" error={errors.name?.message}>
          <Input
            id="user-name"
            autoComplete="off"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={describedBy('user-name', errors.name?.message)}
            {...register('name')}
          />
        </Field>
        <Field id="user-email" label="Adresse e-mail" error={errors.email?.message}>
          <Input
            id="user-email"
            type="email"
            autoComplete="off"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={describedBy('user-email', errors.email?.message)}
            {...register('email')}
          />
        </Field>
        <Field id="user-role" label="Rôle" error={errors.role?.message}>
          <Select id="user-role" {...register('role')}>
            {TENANT_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </Field>
        <TemporaryPasswordField
          id="user-password"
          error={errors.password?.message}
          registration={register('password')}
          onGenerate={() => setValue('password', generatePassword(), { shouldValidate: true })}
          getValue={() => getValues('password')}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Création…' : 'Créer l’utilisateur'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type EditValues = z.input<typeof userUpdateSchema>;

export function EditUserDialog({
  user,
  isSelf,
  onOpenChange,
  onSubmit,
}: {
  user: UserAccount;
  isSelf: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: z.output<typeof userUpdateSchema>) => Promise<void>;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<EditValues, unknown, z.output<typeof userUpdateSchema>>({
    resolver: zodResolver(userUpdateSchema),
    defaultValues: {
      name: user.name,
      role: user.role === 'SUPER_ADMIN' ? undefined : user.role,
      status: user.status,
    },
  });

  async function submit(values: z.output<typeof userUpdateSchema>) {
    setFormError(null);
    // Seuls les champs modifiés partent : l'audit ne trace que de vrais changements.
    const changed = Object.fromEntries(
      Object.entries(values).filter(([key]) => dirtyFields[key as keyof EditValues]),
    );
    if (Object.keys(changed).length === 0) {
      onOpenChange(false);
      return;
    }
    try {
      await onSubmit(changed);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Modifier l’utilisateur"
      description={user.email}
    >
      <form noValidate className="grid gap-4" onSubmit={handleSubmit(submit)}>
        <FormError message={formError} />
        <Field id="edit-name" label="Nom complet" error={errors.name?.message}>
          <Input
            id="edit-name"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={describedBy('edit-name', errors.name?.message)}
            {...register('name')}
          />
        </Field>
        <Field
          id="edit-role"
          label="Rôle"
          hint={isSelf ? 'Vous ne pouvez pas modifier votre propre rôle.' : undefined}
        >
          <Select id="edit-role" disabled={isSelf} {...register('role')}>
            {TENANT_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="edit-status"
          label="Statut"
          hint={
            isSelf
              ? 'Vous ne pouvez pas désactiver votre propre compte.'
              : 'Un compte désactivé est déconnecté immédiatement.'
          }
        >
          <Select id="edit-status" disabled={isSelf} {...register('status')}>
            <option value="ACTIVE">Actif</option>
            <option value="DISABLED">Désactivé</option>
          </Select>
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ResetPasswordDialog({
  user,
  onOpenChange,
  onSubmit,
}: {
  user: UserAccount;
  onOpenChange: (open: boolean) => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<{ password: string }>({
    resolver: zodResolver(passwordResetSchema),
    defaultValues: { password: generatePassword() },
  });

  async function submit(values: { password: string }) {
    setFormError(null);
    try {
      await onSubmit(values.password);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Réinitialiser le mot de passe"
      description={`${user.name} sera déconnecté de toutes ses sessions.`}
    >
      <form noValidate className="grid gap-4" onSubmit={handleSubmit(submit)}>
        <FormError message={formError} />
        <TemporaryPasswordField
          id="reset-password"
          error={errors.password?.message}
          registration={register('password')}
          onGenerate={() => setValue('password', generatePassword(), { shouldValidate: true })}
          getValue={() => getValues('password')}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Enregistrement…' : 'Définir le mot de passe'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
