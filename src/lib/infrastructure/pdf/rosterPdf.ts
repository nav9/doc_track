/**
 * A single-page A4 duty roster generated entirely on the client with jsPDF.
 *
 * The department/month/hospital heading, every date, the prescribed note and
 * the signature block must all fit on the first page. Row height and font size
 * shrink automatically for a full 31-day month.
 */
import { jsPDF } from 'jspdf';
import type { RosterPdfData, PdfColumn } from './rosterData';

const MARGIN = 14;
const FONT = 'helvetica';

function wrap(
  doc: jsPDF,
  text: string,
  width: number,
  size: number,
  weight: 'normal' | 'bold' = 'normal'
): string[] {
  doc.setFont(FONT, weight);
  doc.setFontSize(size);
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (doc.getTextWidth(candidate) <= width || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export function generateRosterPdf(data: RosterPdfData, monthName: string): Blob {
  const doc = new jsPDF({
    orientation: data.orientation,
    unit: 'mm',
    format: 'a4',
    compress: true
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - MARGIN * 2;
  const totalWeight = data.columns.reduce((sum, column) => sum + column.width, 0);
  const columnWidths = data.columns.map((column) => (column.width / totalWeight) * usableWidth);

  doc.setTextColor(23, 32, 51);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(14);
  doc.text(data.departmentHeading, MARGIN, MARGIN + 1, { maxWidth: usableWidth });
  doc.setFontSize(11);
  doc.text(data.rosterHeading, MARGIN, MARGIN + 9, { maxWidth: usableWidth });
  if (data.hospital) {
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(90, 98, 112);
    doc.text(data.hospital, MARGIN, MARGIN + 15);
    doc.setTextColor(23, 32, 51);
  }

  let y = MARGIN + 22;
  const headerHeight = 7;
  doc.setFillColor(234, 241, 255);
  doc.rect(MARGIN, y, usableWidth, headerHeight, 'F');
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8);
  let x = MARGIN;
  data.columns.forEach((column, index) => {
    // Table headings are deliberately left aligned.
    doc.text(column.label, x + 2, y + 4.7, { align: 'left' });
    x += columnWidths[index];
  });
  y += headerHeight;

  // Reserve room for the note, signature block and generated-on line.
  const signatureY = pageHeight - 45;
  const tableBottom = signatureY - 28;
  const rowCount = Math.max(1, data.rows.length);
  const rowHeight = Math.min(6.5, Math.max(4.1, (tableBottom - y) / rowCount));
  const fontSize = rowHeight < 5 ? 6.6 : rowHeight < 5.8 ? 7.2 : 7.8;

  doc.setFont(FONT, 'normal');
  doc.setFontSize(fontSize);

  for (const row of data.rows) {
    const wrappedCells = data.columns.map((column, index) =>
      wrap(doc, row.cells[column.key] ?? '', columnWidths[index] - 3, fontSize)
    );
    const height = Math.max(rowHeight, wrappedCells.reduce((max, lines) => Math.max(max, lines.length), 1) * (fontSize * 0.42) + 2);

    if (row.isWeekend) {
      doc.setFillColor(248, 250, 252);
      doc.rect(MARGIN, y, usableWidth, height, 'F');
    }
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.15);
    doc.line(MARGIN, y + height, MARGIN + usableWidth, y + height);

    let cellX = MARGIN;
    wrappedCells.forEach((lines, index) => {
      const column: PdfColumn = data.columns[index];
      const align = column.align ?? 'left';
      const textX = align === 'center' ? cellX + columnWidths[index] / 2 : cellX + 1.5;
      doc.text(lines, textX, y + fontSize * 0.65 + 1.2, {
        align: align === 'center' ? 'center' : 'left'
      });
      cellX += columnWidths[index];
    });
    y += height;
  }

  // The prescribed note belongs on the first (and only) page.
  doc.setFont(FONT, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(23, 32, 51);
  doc.text(data.footerNote, MARGIN, Math.min(y + 7, signatureY - 14), {
    maxWidth: usableWidth
  });

  if (data.showSignatureBlock) {
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, signatureY, MARGIN + 55, signatureY);
    doc.line(pageWidth - MARGIN - 60, signatureY, pageWidth - MARGIN, signatureY);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.text('Signature', pageWidth - MARGIN - 60, signatureY + 5);
  }

  doc.setFont(FONT, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(110, 118, 132);
  doc.text(`Generated on ${data.generatedOn}`, MARGIN, pageHeight - 8);
  doc.text('One-page A4 roster', pageWidth - MARGIN, pageHeight - 8, { align: 'right' });
  doc.setTextColor(23, 32, 51);

  doc.setProperties({
    title: `${data.title} — ${data.periodLabel}${monthName ? ` (${monthName})` : ''}`,
    subject: 'Doctor duty roster',
    creator: 'DocTrack'
  });

  return doc.output('blob');
}
