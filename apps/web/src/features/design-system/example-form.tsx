'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const schema = z.object({
  name: z.string().trim().min(2, 'Saisissez au moins 2 caractères.'),
  yieldPages: z.coerce
    .number<string>('Saisissez un nombre.')
    .int('Saisissez un nombre entier de pages.')
    .positive('Le rendement doit être supérieur à 0.'),
});

/** Démontre le motif de formulaire : aucune donnée n'est envoyée au serveur. */
export function ExampleForm() {
  const [validated, setValidated] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', yieldPages: '' },
  });

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={handleSubmit(() => setValidated(true))}
      onChange={() => setValidated(false)}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="ds-name">Nom du toner</Label>
        <Input
          id="ds-name"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'ds-name-error' : undefined}
          {...register('name')}
        />
        {errors.name && (
          <p id="ds-name-error" className="text-xs text-danger">
            {errors.name.message}
          </p>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ds-yield">Rendement constructeur (pages)</Label>
        <Input
          id="ds-yield"
          inputMode="numeric"
          aria-invalid={Boolean(errors.yieldPages)}
          aria-describedby={errors.yieldPages ? 'ds-yield-error' : undefined}
          {...register('yieldPages')}
        />
        {errors.yieldPages && (
          <p id="ds-yield-error" className="text-xs text-danger">
            {errors.yieldPages.message}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit">Valider</Button>
        {validated && (
          <p role="status" className="text-[13px] text-success">
            Saisie valide. Rien n’a été enregistré.
          </p>
        )}
      </div>
    </form>
  );
}
