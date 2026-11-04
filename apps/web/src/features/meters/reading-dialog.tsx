'use client';

import type { ColorMode, MeterReading } from '@arksen/shared-types';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api';
import { numberFormat } from './meters-ui';

/** Date et heure locales au format d'un champ `datetime-local`. */
function localNow(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

interface ReadingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  colorMode: ColorMode;
  /** Dernier relevé, pour aider à repérer une erreur de saisie. */
  last: MeterReading | null;
  onSubmit: (values: {
    readAt: string;
    blackCount: number;
    colorCount: number | null;
    isReset: boolean;
    notes: string | null;
  }) => Promise<unknown>;
}

const toCount = (value: string) => (value.trim() === '' ? NaN : Number(value.replace(/\s/g, '')));

export function ReadingDialog({
  open,
  onOpenChange,
  colorMode,
  last,
  onSubmit,
}: ReadingDialogProps) {
  const color = colorMode === 'COLOR';
  const [readAt, setReadAt] = useState(localNow);
  const [black, setBlack] = useState('');
  const [colorValue, setColorValue] = useState('');
  const [isReset, setIsReset] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const blackCount = toCount(black);
  const colorCount = toCount(colorValue);
  const lower =
    !isReset &&
    last !== null &&
    ((Number.isFinite(blackCount) && blackCount < last.blackCount) ||
      (color && Number.isFinite(colorCount) && colorCount < (last.colorCount ?? 0)));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!readAt) return setError('Saisissez la date et l’heure du relevé.');
    if (!Number.isInteger(blackCount) || blackCount < 0)
      return setError('Le compteur noir et blanc est un nombre entier positif.');
    if (color && (!Number.isInteger(colorCount) || colorCount < 0))
      return setError('Le compteur couleur est un nombre entier positif.');
    setPending(true);
    try {
      await onSubmit({
        readAt: new Date(readAt).toISOString(),
        blackCount,
        colorCount: color ? colorCount : null,
        isReset,
        notes: notes.trim() || null,
      });
      setBlack('');
      setColorValue('');
      setIsReset(false);
      setNotes('');
      setReadAt(localNow());
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
      title="Nouveau relevé"
      description="Relevez les compteurs affichés par la machine (page de configuration ou écran de facturation)."
    >
      <form noValidate className="grid gap-4" onSubmit={submit}>
        <FormError message={error} />
        <Field id="reading-readAt" label="Date et heure du relevé">
          <Input
            id="reading-readAt"
            type="datetime-local"
            value={readAt}
            max={localNow()}
            onChange={(event) => setReadAt(event.target.value)}
          />
        </Field>
        <div className={color ? 'grid gap-4 sm:grid-cols-2' : 'grid gap-4'}>
          <Field
            id="reading-black"
            label="Compteur noir et blanc"
            hint={last ? `Précédent : ${numberFormat.format(last.blackCount)}` : undefined}
          >
            <Input
              id="reading-black"
              inputMode="numeric"
              autoComplete="off"
              className="tabular-nums"
              value={black}
              onChange={(event) => setBlack(event.target.value)}
            />
          </Field>
          {color && (
            <Field
              id="reading-color"
              label="Compteur couleur"
              hint={
                last?.colorCount != null
                  ? `Précédent : ${numberFormat.format(last.colorCount)}`
                  : undefined
              }
            >
              <Input
                id="reading-color"
                inputMode="numeric"
                autoComplete="off"
                className="tabular-nums"
                value={colorValue}
                onChange={(event) => setColorValue(event.target.value)}
              />
            </Field>
          )}
        </div>
        {lower && (
          <p className="rounded-md border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[13px] text-warning">
            Un compteur est inférieur au relevé précédent. Vérifiez la saisie ; si la carte ou le
            compteur a été remplacé, cochez la remise à zéro.
          </p>
        )}
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--primary)]"
            checked={isReset}
            onChange={(event) => setIsReset(event.target.checked)}
          />
          <span>
            <span className="font-medium">Compteur remis à zéro ou remplacé</span>
            <span className="block text-[13px] text-muted-foreground">
              Aucun volume n’est calculé entre ce relevé et le précédent.
            </span>
          </span>
        </label>
        <Field id="reading-notes" label="Notes" hint="Facultatif">
          <Textarea
            id="reading-notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Enregistrement…' : 'Enregistrer le relevé'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
