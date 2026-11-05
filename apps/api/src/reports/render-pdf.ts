import PDFDocument from 'pdfkit';
import {
  formatCell,
  frenchDate,
  periodLabel,
  type ReportDocument,
  type ReportSection,
} from './report-model.js';

const PRIMARY = '#0f5c45';
const SOFT = '#e6f0ec';
const INK = '#14201b';
const MUTED = '#5d6b65';
const LINE = '#dfe5e2';
const MARGIN = 36;

/** Caractères au-delà de Latin-1 que les polices standard du PDF (WinAnsi) savent écrire. */
const WIN_ANSI = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Texte sûr pour les polices standard : espaces insécables et symboles hors jeu remplacés. */
export function pdfText(value: string): string {
  return value
    .replace(/[\u00A0\u202F\u2009]/g, ' ')
    .replace(/→/g, '->')
    .replace(/[≤]/g, '<=')
    .replace(/[≥]/g, '>=')
    .replace(/./gu, (char) => (char.charCodeAt(0) <= 0xff || WIN_ANSI.has(char) ? char : '?'));
}

/** PDF A4 paysage : en-tête, indicateurs, tableaux paginés avec en-têtes répétés, pied de page. */
export function renderPdf(document: ReportDocument): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: MARGIN,
    bufferPages: true,
    info: {
      Title: document.title,
      Author: 'ARKSEN PRINT MANAGER',
      Subject: `${document.tenantName} · ${periodLabel(document)}`,
    },
  });
  const chunks: Buffer[] = [];
  pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  const width = pdf.page.width - MARGIN * 2;
  const bottom = () => pdf.page.height - MARGIN - 18;

  // En-tête du rapport.
  pdf.rect(0, 0, pdf.page.width, 70).fill(PRIMARY);
  pdf
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(pdfText(document.title), MARGIN, 20, { width });
  pdf
    .font('Helvetica')
    .fontSize(10)
    .text(pdfText(`${document.tenantName} · ${periodLabel(document)}`), MARGIN, 44, { width });
  pdf.y = 90;

  for (const section of document.sections) drawSection(section);

  if (document.notes.length) {
    if (pdf.y > bottom() - 60) pdf.addPage();
    pdf
      .moveDown(0.5)
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('Méthode', MARGIN, pdf.y, { width });
    pdf.font('Helvetica').fontSize(8).fillColor(MUTED);
    for (const note of document.notes) pdf.text(pdfText(note), { width }).moveDown(0.2);
  }

  // Pied de page : date de génération et numéro de page.
  const range = pdf.bufferedPageRange();
  for (let index = 0; index < range.count; index++) {
    pdf.switchToPage(range.start + index);
    pdf
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        pdfText(
          `ARKSEN PRINT MANAGER · généré le ${frenchDate(document.generatedAt)} · page ${index + 1} / ${range.count}`,
        ),
        MARGIN,
        pdf.page.height - MARGIN + 4,
        { width, align: 'right', lineBreak: false },
      );
  }
  pdf.end();
  return done;

  function drawSection(section: ReportSection) {
    if (pdf.y > bottom() - 80) pdf.addPage();
    pdf
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(pdfText(section.title), MARGIN, pdf.y, { width });
    if (section.description) {
      pdf
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(pdfText(section.description), { width });
    }
    pdf.moveDown(0.4);

    if (section.kpis?.length) {
      const boxWidth = Math.min(180, (width - (section.kpis.length - 1) * 8) / section.kpis.length);
      const top = pdf.y;
      section.kpis.forEach((kpi, index) => {
        const x = MARGIN + index * (boxWidth + 8);
        pdf.roundedRect(x, top, boxWidth, 42, 6).fill(SOFT);
        pdf
          .fillColor(MUTED)
          .font('Helvetica')
          .fontSize(8)
          .text(pdfText(kpi.label), x + 8, top + 7, { width: boxWidth - 16 });
        pdf
          .fillColor(INK)
          .font('Helvetica-Bold')
          .fontSize(12)
          .text(pdfText(kpi.value), x + 8, top + 21, { width: boxWidth - 16 });
      });
      pdf.y = top + 52;
    }

    const weights = section.columns.map((column) => column.width ?? 1);
    const total = weights.reduce((sum, value) => sum + value, 0);
    const widths = weights.map((value) => (value / total) * width);
    const align = (kind: string) => (kind === 'text' || kind === 'date' ? 'left' : 'right');

    const drawHeader = () => {
      const top = pdf.y;
      pdf.rect(MARGIN, top, width, 18).fill(PRIMARY);
      let x = MARGIN;
      section.columns.forEach((column, index) => {
        pdf
          .fillColor('#ffffff')
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .text(pdfText(column.label), x + 4, top + 5, {
            width: widths[index]! - 8,
            align: align(column.kind),
            lineBreak: false,
            ellipsis: true,
          });
        x += widths[index]!;
      });
      pdf.y = top + 18;
    };

    drawHeader();
    const rows = [...section.rows, ...(section.total ? [section.total] : [])];
    if (!rows.length) {
      pdf
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(8.5)
        .text('Aucune donnée sur la période.', MARGIN + 4, pdf.y + 5);
      pdf.y += 20;
    }
    rows.forEach((row, rowIndex) => {
      const isTotal = Boolean(section.total) && rowIndex === rows.length - 1;
      const cells = section.columns.map((column) =>
        pdfText(formatCell(row[column.key] ?? null, column.kind, document.currency)),
      );
      pdf.font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      const height = Math.max(
        16,
        ...cells.map((cell, index) => pdf.heightOfString(cell, { width: widths[index]! - 8 }) + 7),
      );
      if (pdf.y + height > bottom()) {
        pdf.addPage();
        pdf.y = MARGIN;
        drawHeader();
      }
      const top = pdf.y;
      if (isTotal) pdf.rect(MARGIN, top, width, height).fill(SOFT);
      else if (rowIndex % 2 === 1) pdf.rect(MARGIN, top, width, height).fill('#f7f9f8');
      let x = MARGIN;
      cells.forEach((cell, index) => {
        pdf
          .fillColor(INK)
          .font(isTotal ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(8)
          .text(cell, x + 4, top + 4, {
            width: widths[index]! - 8,
            align: align(section.columns[index]!.kind),
          });
        x += widths[index]!;
      });
      pdf
        .moveTo(MARGIN, top + height)
        .lineTo(MARGIN + width, top + height)
        .strokeColor(LINE)
        .lineWidth(0.5)
        .stroke();
      pdf.y = top + height;
    });
    pdf.y += 18;
  }
}
