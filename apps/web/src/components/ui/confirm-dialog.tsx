'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { Button } from './button';
import { Dialog } from './dialog';
import { FormError } from './field';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
}

/** Confirmation d'une action irréversible. L'erreur de l'API s'affiche dans la fenêtre. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setError(null);
        onOpenChange(next);
      }}
      title={title}
      description={description}
    >
      <div className="grid gap-4">
        <FormError message={error} />
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (caught) {
                setError(errorMessage(caught, 'Action impossible.'));
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? 'Patientez…' : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
