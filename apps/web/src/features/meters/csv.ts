/** Lecture d'un fichier CSV de relevés, avant envoi à l'API (qui revalide chaque ligne). */

export interface ImportRow {
  serialNumber: string;
  readAt: string;
  blackCount: number;
  colorCount: number | null;
  isReset: boolean;
}

export interface ParsedCsv {
  rows: ImportRow[];
  /** Erreurs par ligne du fichier (en-tête comprise dans la numérotation). */
  errors: { line: number; message: string }[];
}

export const CSV_TEMPLATE =
  'numero_serie;date;noir;couleur;remise_a_zero\n' +
  'SN-0001;04/11/2026 08:30;125 000;48 000;non\n' +
  'SN-0002;2026-11-04;98000;;non\n';

const COLUMNS = {
  serialNumber: ['numerodeserie', 'numeroserie', 'serie', 'serial', 'serialnumber', 'ns'],
  readAt: ['date', 'datereleve', 'dateheure', 'datedureleve', 'readat'],
  blackCount: ['noir', 'noiretblanc', 'nb', 'black', 'mono', 'compteurnoir'],
  colorCount: ['couleur', 'color', 'compteurcouleur'],
  isReset: ['remiseazero', 'reset', 'raz'],
} as const;
type Column = keyof typeof COLUMNS;

function normalize(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function detectSeparator(line: string): string {
  const counts = [';', ',', '\t'].map(
    (separator) => [separator, line.split(separator).length] as const,
  );
  return counts.sort((a, b) => b[1] - a[1])[0]![0];
}

function splitLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === separator && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** Compteur : chiffres seuls, les espaces de milliers sont tolérés. */
function parseCount(value: string): number | null {
  const cleaned = value.replace(/[\s  ]/g, '');
  return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
}

/**
 * Date et heure locales : `AAAA-MM-JJ` ou `JJ/MM/AAAA`, avec une heure facultative.
 * Une date seule est placée à midi, pour ne pas basculer sur le jour voisin.
 */
export function parseDate(value: string): Date | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  const french = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  const parts = iso
    ? [iso[1], iso[2], iso[3], iso[4], iso[5], iso[6]]
    : french
      ? [french[3], french[2], french[1], french[4], french[5], french[6]]
      : null;
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.map((part) =>
    part ? Number(part) : undefined,
  );
  const date = new Date(year!, month! - 1, day!, hour ?? 12, minute ?? 0, second ?? 0);
  // Rejette les dates impossibles (31/02) que Date corrigerait en silence.
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day
    ? date
    : null;
}

export function parseMeterCsv(text: string): ParsedCsv {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() !== '');
  if (headerIndex === -1) {
    return { rows: [], errors: [{ line: 1, message: 'Le fichier est vide.' }] };
  }
  const separator = detectSeparator(lines[headerIndex]!);
  const headers = splitLine(lines[headerIndex]!, separator).map(normalize);
  const position = {} as Record<Column, number>;
  for (const [column, aliases] of Object.entries(COLUMNS) as [Column, readonly string[]][]) {
    position[column] = headers.findIndex((header) => aliases.includes(header));
  }
  const missing = (['serialNumber', 'readAt', 'blackCount'] as const).filter(
    (column) => position[column] === -1,
  );
  if (missing.length) {
    return {
      rows: [],
      errors: [
        {
          line: headerIndex + 1,
          message:
            'Colonnes attendues : numero_serie, date, noir, et facultativement couleur et remise_a_zero.',
        },
      ],
    };
  }

  const rows: ImportRow[] = [];
  const errors: ParsedCsv['errors'] = [];
  lines.slice(headerIndex + 1).forEach((line, offset) => {
    if (line.trim() === '') return;
    const number = headerIndex + offset + 2;
    const cells = splitLine(line, separator);
    const cell = (column: Column) =>
      position[column] === -1 ? '' : (cells[position[column]] ?? '');

    const serialNumber = cell('serialNumber');
    const readAt = parseDate(cell('readAt'));
    const blackCount = parseCount(cell('blackCount'));
    const colorText = cell('colorCount');
    const colorCount = colorText === '' ? null : parseCount(colorText);

    const problem = !serialNumber
      ? 'numéro de série manquant'
      : !readAt
        ? `date illisible « ${cell('readAt')} »`
        : blackCount === null
          ? `compteur noir illisible « ${cell('blackCount')} »`
          : colorText !== '' && colorCount === null
            ? `compteur couleur illisible « ${colorText} »`
            : null;
    if (problem) {
      errors.push({ line: number, message: problem });
      return;
    }
    rows.push({
      serialNumber,
      readAt: readAt!.toISOString(),
      blackCount: blackCount!,
      colorCount,
      isReset: ['oui', 'o', 'true', 'vrai', '1', 'x', 'yes'].includes(
        cell('isReset').toLowerCase(),
      ),
    });
  });
  return { rows, errors };
}
