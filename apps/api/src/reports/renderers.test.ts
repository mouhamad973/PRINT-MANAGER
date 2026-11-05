import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { csvValue, renderCsv } from './render-csv.js';
import { pdfText, renderPdf } from './render-pdf.js';
import { renderXlsx } from './render-xlsx.js';
import { formatCell, type ReportDocument } from './report-model.js';

const document: ReportDocument = {
  slug: 'test',
  title: 'Coûts d’impression',
  tenantName: 'Imprimerie « test »',
  period: { from: '2026-10-01', to: '2026-10-31' },
  generatedAt: new Date('2026-11-01T08:00:00Z'),
  currency: 'XOF',
  notes: ['Toner estimé par le moteur CMJN.'],
  sections: [
    {
      title: 'Par machine',
      kpis: [{ label: 'Coût total', value: '50 096 XOF' }],
      columns: [
        { key: 'name', label: 'Machine', kind: 'text', width: 2 },
        { key: 'pages', label: 'Pages', kind: 'int' },
        { key: 'cost', label: 'Coût', kind: 'money' },
        { key: 'share', label: 'Part', kind: 'percent' },
      ],
      rows: Array.from({ length: 120 }, (_, index) => ({
        name: index === 0 ? 'Presse; "atelier"' : `Machine ${index}`,
        pages: 12000 + index,
        cost: 50096.5,
        share: 12.5,
      })),
      total: { name: 'Total', pages: 1_441_140, cost: 6_011_580, share: 100 },
    },
  ],
};

describe('CSV', () => {
  it('écrit pour un tableur en français, sans formule injectable', () => {
    expect(csvValue('Presse; "atelier"')).toBe('"Presse; ""atelier"""');
    expect(csvValue('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvValue(50096.5, 'money')).toBe('50096,5');
    expect(csvValue(12000.4, 'int')).toBe('12000');
    const text = renderCsv(document).toString('utf8');
    expect(text.startsWith('﻿Coûts d’impression')).toBe(true);
    expect(text).toContain('Machine;Pages;Coût;Part\r\n"Presse; ""atelier""";12000;50096,5;12,5');
    expect(text).toContain('Total;1441140;6011580;100');
  });
});

describe('Excel', () => {
  it('écrit une feuille par section, avec des nombres', async () => {
    const buffer = await renderXlsx(document);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Par machine', 'Méthode']);
    const sheet = workbook.getWorksheet('Par machine')!;
    expect(sheet.getRow(4).getCell(1).value).toBe('Machine');
    expect(sheet.getRow(5).getCell(2).value).toBe(12000);
    expect(sheet.getRow(5).getCell(3).numFmt).toContain('XOF');
  });
});

describe('PDF', () => {
  it('pagine un long tableau', async () => {
    const buffer = await renderPdf(document);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    // 120 lignes ne tiennent pas sur une page A4 paysage.
    const pages = buffer.toString('latin1').match(/\/Type \/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThan(2);
  });

  it('remplace ce que les polices standard ne savent pas écrire', () => {
    expect(pdfText('10 000 XOF')).toBe('10 000 XOF');
    expect(pdfText('janv. → févr.')).toBe('janv. -> févr.');
    expect(pdfText('Coût ’ € 😀')).toBe('Coût ’ € ?');
  });

  it('formate les cellules selon leur type', () => {
    expect(formatCell(12000, 'int', 'XOF')).toBe('12 000');
    expect(formatCell(1.5, 'money', 'XOF')).toBe('1,50 XOF');
    expect(formatCell(null, 'money', 'XOF')).toBe('—');
    expect(formatCell('2026-10-31', 'date', 'XOF')).toBe('31/10/2026');
  });
});
