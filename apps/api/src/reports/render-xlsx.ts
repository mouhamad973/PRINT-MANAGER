import ExcelJS from 'exceljs';
import { periodLabel, type ColumnKind, type ReportDocument } from './report-model.js';

const PRIMARY = 'FF0F5C45';

function numberFormat(kind: ColumnKind, currency: string): string | undefined {
  switch (kind) {
    case 'int':
      return '# ##0';
    case 'decimal':
      return '# ##0.00';
    case 'money':
      return `# ##0.00 "${currency}"`;
    case 'percent':
      return '0.0" %"';
    default:
      return undefined;
  }
}

/** Classeur Excel : une feuille par section, de vrais nombres avec leur format. */
export async function renderXlsx(document: ReportDocument): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ARKSEN PRINT MANAGER';
  workbook.created = document.generatedAt;
  workbook.title = document.title;

  const used = new Set<string>();
  for (const section of document.sections) {
    // Nom de feuille : 31 caractères au plus, sans caractères interdits, unique.
    let name =
      section.title
        .replace(/[\\/*?:[\]]/g, ' ')
        .slice(0, 31)
        .trim() || 'Feuille';
    for (let index = 2; used.has(name); index++) name = `${name.slice(0, 27)} (${index})`;
    used.add(name);
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4 }] });

    sheet.addRow([document.title]).font = { bold: true, size: 14 };
    sheet.addRow([`${document.tenantName} · ${periodLabel(document)} · ${section.title}`]).font = {
      color: { argb: 'FF5D6B65' },
    };
    sheet.addRow([]);
    const header = sheet.addRow(section.columns.map((column) => column.label));
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRIMARY } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });

    const rows = [...section.rows, ...(section.total ? [section.total] : [])];
    rows.forEach((row, index) => {
      const added = sheet.addRow(
        section.columns.map((column) => {
          const value = row[column.key] ?? null;
          if (column.kind === 'date' && typeof value === 'string') return new Date(value);
          return value;
        }),
      );
      if (section.total && index === rows.length - 1) added.font = { bold: true };
    });

    section.columns.forEach((column, index) => {
      const sheetColumn = sheet.getColumn(index + 1);
      const format =
        column.kind === 'date' ? 'dd/mm/yyyy' : numberFormat(column.kind, document.currency);
      if (format) sheetColumn.numFmt = format;
      const longest = Math.max(
        column.label.length,
        ...rows.map((row) => String(row[column.key] ?? '').length),
      );
      sheetColumn.width = Math.min(48, Math.max(10, longest + 2));
    });
    sheet.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: 4, column: section.columns.length },
    };
  }

  if (document.notes.length) {
    const sheet = workbook.addWorksheet('Méthode');
    sheet.getColumn(1).width = 120;
    for (const note of document.notes) sheet.addRow([note]).alignment = { wrapText: true };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
