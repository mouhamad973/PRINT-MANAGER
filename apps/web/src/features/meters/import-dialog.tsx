'use client';

import type { MeterImportResult } from '@arksen/shared-types';
import { Download, FileUp } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormError } from '@/components/ui/field';
import { errorMessage } from '@/lib/api';
import { send } from '@/features/fleet/api';
import { CSV_TEMPLATE, parseMeterCsv, type ParsedCsv } from './csv';
import { numberFormat } from './meters-ui';

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  onImported: () => Promise<unknown>;
}

function downloadTemplate() {
  // Le BOM permet à Excel de lire les accents.
  const blob = new Blob([`﻿${CSV_TEMPLATE}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'modele-releves-compteurs.csv';
  link.click();
  URL.revokeObjectURL(url);
}

/** Import de relevés depuis un fichier CSV, lu dans le navigateur puis revalidé par l'API. */
export function ImportDialog({ open, onOpenChange, tenantId, onImported }: ImportDialogProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [result, setResult] = useState<MeterImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setFileName(null);
    setParsed(null);
    setResult(null);
    setError(null);
  }

  async function submit() {
    if (!parsed?.rows.length) return;
    setPending(true);
    setError(null);
    try {
      const reply = await send<MeterImportResult>(
        'POST',
        `/tenants/${tenantId}/meter-readings/import`,
        {
          rows: parsed.rows,
        },
      );
      setResult(reply);
      await onImported();
    } catch (caught) {
      setError(errorMessage(caught, 'Import impossible.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title="Importer des relevés"
      description="Un fichier CSV, une ligne par relevé. Les machines sont reconnues par leur numéro de série."
      className="max-w-xl"
    >
      <div className="grid gap-5">
        <div className="rounded-lg bg-surface-raised p-4 text-[13px] text-muted-foreground">
          <p>
            Colonnes : <span className="font-mono text-foreground">numero_serie</span>,{' '}
            <span className="font-mono text-foreground">date</span>,{' '}
            <span className="font-mono text-foreground">noir</span>, et facultativement{' '}
            <span className="font-mono text-foreground">couleur</span> et{' '}
            <span className="font-mono text-foreground">remise_a_zero</span>. Dates au format
            JJ/MM/AAAA ou AAAA-MM-JJ, avec l’heure si possible ; une date seule est placée à midi.
          </p>
          <p className="mt-2">
            Rejouer un import ne crée pas de doublon : un relevé déjà présent est ignoré.
          </p>
          <Button variant="ghost" size="sm" className="-ml-3.5 mt-2" onClick={downloadTemplate}>
            <Download aria-hidden="true" />
            Télécharger un modèle
          </Button>
        </div>

        {!result && (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-input px-4 py-6 text-center transition-colors hover:border-primary hover:bg-primary-soft/40">
            <FileUp className="size-6 text-primary" aria-hidden="true" />
            <span className="font-medium">{fileName ?? 'Choisir un fichier CSV'}</span>
            <span className="text-xs text-muted-foreground">
              Séparateur point-virgule, virgule ou tabulation
            </span>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                setResult(null);
                setError(null);
                setParsed(parseMeterCsv(await file.text()));
              }}
            />
          </label>
        )}

        <FormError message={error} />

        {parsed && !result && (
          <div className="grid gap-2 text-[13px]">
            <p>
              <span className="font-semibold">{numberFormat.format(parsed.rows.length)}</span>{' '}
              relevé
              {parsed.rows.length > 1 ? 's' : ''} prêt{parsed.rows.length > 1 ? 's' : ''} à importer
              {parsed.errors.length > 0 && (
                <>
                  , <span className="font-semibold text-warning">{parsed.errors.length}</span> ligne
                  {parsed.errors.length > 1 ? 's' : ''} ignorée{parsed.errors.length > 1 ? 's' : ''}
                </>
              )}
              .
            </p>
            <ErrorList
              items={parsed.errors.map((item) => ({
                label: `Ligne ${item.line}`,
                message: item.message,
              }))}
            />
          </div>
        )}

        {result && (
          <div role="status" className="grid gap-2 text-[13px]">
            <p className="rounded-md border border-success/25 bg-success/10 px-3.5 py-2.5 text-success">
              {numberFormat.format(result.created)} relevé{result.created > 1 ? 's' : ''} importé
              {result.created > 1 ? 's' : ''}
              {result.duplicates > 0 &&
                `, ${numberFormat.format(result.duplicates)} déjà présent${result.duplicates > 1 ? 's' : ''}`}
              .
            </p>
            <ErrorList
              items={result.errors.map((item) => ({
                label: `Relevé ${item.row}`,
                message: item.message,
              }))}
            />
          </div>
        )}

        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {result ? 'Fermer' : 'Annuler'}
          </Button>
          {!result && (
            <Button disabled={pending || !parsed?.rows.length} onClick={submit}>
              {pending ? 'Import…' : 'Importer'}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function ErrorList({ items }: { items: { label: string; message: string }[] }) {
  if (!items.length) return null;
  return (
    <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-3 text-xs">
      {items.slice(0, 50).map((item) => (
        <li key={`${item.label}-${item.message}`}>
          <span className="font-medium">{item.label} :</span> {item.message}
        </li>
      ))}
      {items.length > 50 && (
        <li className="text-muted-foreground">… et {items.length - 50} autres</li>
      )}
    </ul>
  );
}
