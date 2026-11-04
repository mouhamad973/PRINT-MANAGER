/** PDF minimaux pour les tests de bout en bout : chaque page est un flux de contenu. */

export const A4: [number, number] = [595.28, 841.89];
export const A3: [number, number] = [841.89, 1190.55];

export interface TestPage {
  content?: string;
  size?: [number, number];
}

/** Page dont la moitié basse (ou une autre fraction) est remplie d'une couleur RVB. */
export function fill(rgb: string, fraction = 1, size: [number, number] = A4): TestPage {
  return { content: `${rgb} rg 0 0 ${size[0]} ${size[1] * fraction} re f`, size };
}

export function buildPdf(pages: TestPage[]): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 3 + 2 * index);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  pages.forEach((page, index) => {
    const [width, height] = page.size ?? A4;
    const content = page.content ?? '';
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents ${pageIds[index]! + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });

  let output = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}
