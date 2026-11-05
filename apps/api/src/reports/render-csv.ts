import { periodLabel, type Cell, type ReportColumn, type ReportDocument } from './report-model.js';

const SEPARATOR = ';';
/** Marque d'ordre des octets UTF-8 : Excel reconnaît alors les accents. */
const BOM = String.fromCharCode(0xfeff);
/** Fin de ligne CSV (RFC 4180). */
const LINE_END = String.fromCharCode(13, 10);

/** Échappe une valeur CSV (RFC 4180) et neutralise les formules (=, +, -, @) d'un tableur. */
export function csvValue(value: Cell, kind: ReportColumn['kind'] = 'text'): string {
  if (value === null) return '';
  let text: string;
  if (typeof value === 'number') {
    // Tableur réglé en français : virgule décimale, pas de séparateur de milliers.
    text = kind === 'int' ? String(Math.round(value)) : String(value).replace('.', ',');
  } else {
    text = value;
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  }
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV pour un tableur en français : séparateur point-virgule, BOM UTF-8 (Excel reconnaît
 * alors les accents). Chaque section est précédée de son titre et séparée par une ligne vide.
 */
export function renderCsv(document: ReportDocument): Buffer {
  const lines: string[] = [
    csvValue(document.title),
    csvValue(`${document.tenantName} · ${periodLabel(document)}`),
    '',
  ];
  for (const section of document.sections) {
    lines.push(csvValue(section.title));
    lines.push(section.columns.map((column) => csvValue(column.label)).join(SEPARATOR));
    for (const row of [...section.rows, ...(section.total ? [section.total] : [])]) {
      lines.push(
        section.columns
          .map((column) => csvValue(row[column.key] ?? null, column.kind))
          .join(SEPARATOR),
      );
    }
    lines.push('');
  }
  return Buffer.from(BOM + lines.join(LINE_END), 'utf8');
}

/** Tableau CSV simple : une ligne d'en-tête puis les lignes, sans titre de rapport. */
export function csvTable(columns: readonly string[], rows: readonly Cell[][]): Buffer {
  const lines = [
    columns.map((column) => csvValue(column)).join(SEPARATOR),
    ...rows.map((row) => row.map((cell) => csvValue(cell)).join(SEPARATOR)),
  ];
  return Buffer.from(BOM + lines.join(LINE_END) + LINE_END, 'utf8');
}
