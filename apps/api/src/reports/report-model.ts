/** Rapport exportable : un en-tête, puis des sections faites d'indicateurs et d'un tableau. */
export type ColumnKind = 'text' | 'int' | 'decimal' | 'money' | 'percent' | 'date';

export interface ReportColumn {
  key: string;
  label: string;
  kind: ColumnKind;
  /** Largeur relative dans le PDF (1 par défaut). */
  width?: number;
}

export type Cell = string | number | null;

export interface ReportSection {
  title: string;
  description?: string;
  kpis?: { label: string; value: string }[];
  columns: ReportColumn[];
  rows: Record<string, Cell>[];
  /** Ligne de total, mise en évidence. */
  total?: Record<string, Cell>;
}

export interface ReportDocument {
  /** Nom de fichier, sans extension. */
  slug: string;
  title: string;
  tenantName: string;
  period: { from: string; to: string } | null;
  generatedAt: Date;
  currency: string;
  /** Rappel de la méthode, imprimé en pied de rapport. */
  notes: string[];
  sections: ReportSection[];
}

const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const percent = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** Date ISO (AAAA-MM-JJ ou complète) au format français. */
export function frenchDate(value: string | Date): string {
  const date =
    typeof value === 'string'
      ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
      : value;
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC' }).format(date);
}

/** Valeur affichée d'une cellule (PDF), selon le type de sa colonne. */
export function formatCell(value: Cell, kind: ColumnKind, currency: string): string {
  if (value === null || value === '') return '—';
  if (typeof value === 'string') return kind === 'date' ? frenchDate(value) : value;
  switch (kind) {
    case 'int':
      return integer.format(value);
    case 'decimal':
      return decimal.format(value);
    case 'money':
      return `${decimal.format(value)} ${currency}`;
    case 'percent':
      return `${percent.format(value)} %`;
    default:
      return String(value);
  }
}

export function periodLabel(document: ReportDocument): string {
  return document.period
    ? `Du ${frenchDate(document.period.from)} au ${frenchDate(document.period.to)}`
    : `Situation au ${frenchDate(document.generatedAt)}`;
}
