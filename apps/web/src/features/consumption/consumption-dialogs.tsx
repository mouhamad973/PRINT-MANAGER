'use client';

import {
  CMYK_LABELS,
  MEASUREMENT_METHOD_LABELS,
  MEASUREMENT_METHODS,
  PAPER_FORMATS,
  type CalibrationProfile,
  type CmykChannel,
  type MeasurementMethod,
} from '@arksen/shared-types';
import { calibrationProfileSchema, measurementCreateSchema } from '@arksen/validation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api';
import { InkLabel } from './consumption-ui';

const toText = (value: number | null) => (value === null ? '' : String(value).replace('.', ','));
const toNumber = (value: string) => (value.trim() === '' ? '' : value.replace(',', '.'));

interface ProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: readonly CmykChannel[];
  profile: CalibrationProfile;
  onSubmit: (values: unknown) => Promise<unknown>;
}

/** Paramètres de calcul d'une machine : aplat moyen, format, support et coefficients manuels. */
export function ProfileDialog({
  open,
  onOpenChange,
  channels,
  profile,
  onSubmit,
}: ProfileDialogProps) {
  const [coverage, setCoverage] = useState(() =>
    Object.fromEntries(
      Object.entries(profile.coverage).map(([key, value]) => [key, toText(value)]),
    ),
  );
  const [coefficients, setCoefficients] = useState(() =>
    Object.fromEntries(
      Object.entries(profile.manualCoefficients).map(([key, value]) => [key, toText(value)]),
    ),
  );
  const [paperFormat, setPaperFormat] = useState(profile.paperFormat);
  const [mediaFactor, setMediaFactor] = useState(toText(profile.mediaFactor));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = calibrationProfileSchema.safeParse({
      coverage: Object.fromEntries(
        Object.entries(coverage).map(([key, value]) => [key, toNumber(value) || 5]),
      ),
      paperFormat,
      mediaFactor: toNumber(mediaFactor),
      manualCoefficients: Object.fromEntries(
        Object.entries(coefficients).map(([key, value]) => [key, toNumber(value)]),
      ),
    });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setPending(true);
    setError(null);
    try {
      await onSubmit(parsed.data);
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
      onOpenChange={onOpenChange}
      title="Paramètres de calcul"
      description="L’aplat moyen sert à estimer la consommation à partir des compteurs, en attendant l’analyse des fichiers."
      className="max-w-xl"
    >
      <form noValidate className="grid gap-5" onSubmit={submit}>
        <FormError message={error} />
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[1fr_7rem_7rem] gap-3 bg-surface-raised px-4 py-2 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
            <span>Encre</span>
            <span>Aplat moyen</span>
            <span>Coefficient</span>
          </div>
          {channels.map((channel) => (
            <div
              key={channel}
              className="grid grid-cols-[1fr_7rem_7rem] items-center gap-3 border-t border-border px-4 py-2.5"
            >
              <InkLabel channel={channel} className="text-sm font-medium" />
              <div className="relative">
                <Input
                  aria-label={`Aplat moyen ${CMYK_LABELS[channel]}`}
                  inputMode="decimal"
                  className="h-9 pr-7 text-right"
                  value={coverage[channel] ?? ''}
                  onChange={(event) =>
                    setCoverage((current) => ({ ...current, [channel]: event.target.value }))
                  }
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-muted-foreground">
                  %
                </span>
              </div>
              <Input
                aria-label={`Coefficient manuel ${CMYK_LABELS[channel]}`}
                inputMode="decimal"
                placeholder="Auto"
                className="h-9 text-right"
                value={coefficients[channel] ?? ''}
                onChange={(event) =>
                  setCoefficients((current) => ({ ...current, [channel]: event.target.value }))
                }
              />
            </div>
          ))}
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          Coefficient vide : calibration automatique, apprise des consommations réelles. Un
          coefficient saisi la remplace.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field
            id="profile-format"
            label="Format dominant"
            hint="A4 si les compteurs comptent déjà un A3 pour deux"
          >
            <Select
              id="profile-format"
              value={paperFormat}
              onChange={(event) => setPaperFormat(event.target.value as typeof paperFormat)}
            >
              {PAPER_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {format}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="profile-media" label="Facteur de support" hint="1 : papier standard">
            <Input
              id="profile-media"
              inputMode="decimal"
              value={mediaFactor}
              onChange={(event) => setMediaFactor(event.target.value)}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface MeasurementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: readonly CmykChannel[];
  onSubmit: (values: unknown) => Promise<unknown>;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Consommation réelle d'une encre sur une période : pesée, ou cartouches vidées. */
export function MeasurementDialog({
  open,
  onOpenChange,
  channels,
  onSubmit,
}: MeasurementDialogProps) {
  const [channel, setChannel] = useState<CmykChannel>(channels[0]!);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(isoToday);
  const [method, setMethod] = useState<MeasurementMethod>('CARTRIDGES');
  const [grams, setGrams] = useState('');
  const [cartridges, setCartridges] = useState('1');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = measurementCreateSchema.safeParse({
      channel,
      from,
      to,
      method,
      grams: method === 'WEIGHING' ? toNumber(grams) : '',
      cartridges: method === 'CARTRIDGES' ? toNumber(cartridges) : '',
      notes,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setPending(true);
    setError(null);
    try {
      await onSubmit(parsed.data);
      setGrams('');
      setNotes('');
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
      onOpenChange={onOpenChange}
      title="Consommation réelle"
      description="Elle est comparée au théorique de la même période, et calibre progressivement la machine."
    >
      <form noValidate className="grid gap-4" onSubmit={submit}>
        <FormError message={error} />
        <div className="grid grid-cols-2 gap-4">
          <Field id="measurement-channel" label="Encre">
            <Select
              id="measurement-channel"
              value={channel}
              onChange={(event) => setChannel(event.target.value as CmykChannel)}
            >
              {channels.map((item) => (
                <option key={item} value={item}>
                  {CMYK_LABELS[item]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="measurement-method" label="Méthode">
            <Select
              id="measurement-method"
              value={method}
              onChange={(event) => setMethod(event.target.value as MeasurementMethod)}
            >
              {MEASUREMENT_METHODS.map((item) => (
                <option key={item} value={item}>
                  {MEASUREMENT_METHOD_LABELS[item]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="measurement-from" label="Du">
            <Input
              id="measurement-from"
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field id="measurement-to" label="Au">
            <Input
              id="measurement-to"
              type="date"
              value={to}
              max={isoToday()}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
        </div>
        {method === 'WEIGHING' ? (
          <Field
            id="measurement-grams"
            label="Toner consommé"
            hint="En grammes, d’après la pesée des cartouches"
          >
            <Input
              id="measurement-grams"
              inputMode="decimal"
              value={grams}
              onChange={(event) => setGrams(event.target.value)}
            />
          </Field>
        ) : (
          <Field
            id="measurement-cartridges"
            label="Cartouches vidées"
            hint="Converties en grammes avec la masse du toner de la fiche technique"
          >
            <Input
              id="measurement-cartridges"
              inputMode="decimal"
              value={cartridges}
              onChange={(event) => setCartridges(event.target.value)}
            />
          </Field>
        )}
        <Field id="measurement-notes" label="Notes" hint="Facultatif">
          <Textarea
            id="measurement-notes"
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
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
