/**
 * A4 duty roster generated entirely on the client with jsPDF.
 *
 * The page uses a portrait layout, centred headings, left-aligned table cells,
 * light cell borders and comfortable row heights. Long names wrap rather than
 * being vertically compressed. If a large font or wrapped names need more room,
 * the table continues on another page with the column header repeated.
 */
import { jsPDF } from 'jspdf';
import type { RosterPdfData, PdfColumn } from './rosterData';
import type { RosterFontFamily } from '../../domain/roster/types';

const MARGIN = 14;
const FONT_BY_FAMILY: Record<RosterFontFamily, string> = {
  helvetica: 'helvetica',
  times: 'times',
  courier: 'courier'
};

function wrap(
  doc: jsPDF,
  text: string,
  width: number,
  size: number,
  font: string,
  weight: 'normal' | 'bold' = 'normal'
): string[] {
  doc.setFont(font, weight);
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
  const font = FONT_BY_FAMILY[data.fontFamily] ?? 'helvetica';
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - MARGIN * 2;
  const totalWeight = data.columns.reduce((sum, column) => sum + column.width, 0);
  const columnWidths = data.columns.map((column) => (column.width / totalWeight) * usableWidth);
  const tableFontSize = Math.max(7, Math.min(12, data.fontSize || 8));
  const rowFloor = Math.max(6.6, tableFontSize * 0.56 + 3.1);
  const headerHeight = 8;
  const bottomLimit = pageHeight - 18;

  const drawHeaderRow = (top: number) => {
    doc.setFillColor(234, 241, 255);
    doc.rect(MARGIN, top, usableWidth, headerHeight, 'F');
    doc.setDrawColor(218, 225, 235);
    doc.setLineWidth(0.2);
    let x = MARGIN;
    data.columns.forEach((column, index) => {
      doc.rect(x, top, columnWidths[index], headerHeight);
      doc.setFont(font, 'bold');
      doc.setFontSize(Math.max(7, tableFontSize));
      doc.text(column.label, x + 2, top + 5.2, { align: 'left' });
      x += columnWidths[index];
    });
  };

  doc.setTextColor(23, 32, 51);
  doc.setFont(font, 'bold');
  doc.setFontSize(14);
  doc.text(data.departmentHeading, pageWidth / 2, MARGIN + 2, { align: 'center' });
  doc.setFontSize(11);
  doc.text(data.rosterHeading, pageWidth / 2, MARGIN + 10, { align: 'center' });

  let y = MARGIN + 18;
  drawHeaderRow(y);
  y += headerHeight;

  for (const row of data.rows) {
    const wrappedCells = data.columns.map((column, index) =>
      wrap(doc, row.cells[column.key] ?? '', columnWidths[index] - 4, tableFontSize, font)
    );
    const lineCount = wrappedCells.reduce((max, lines) => Math.max(max, lines.length), 1);
    const height = Math.max(rowFloor, lineCount * tableFontSize * 0.43 + 3.4);

    if (y + height > bottomLimit) {
      doc.addPage();
      y = MARGIN;
      drawHeaderRow(y);
      y += headerHeight;
    }

    if (row.isWeekend) {
      doc.setFillColor(248, 250, 252);
      doc.rect(MARGIN, y, usableWidth, height, 'F');
    }

    let cellX = MARGIN;
    wrappedCells.forEach((lines, index) => {
      const column: PdfColumn = data.columns[index];
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      doc.rect(cellX, y, columnWidths[index], height);
      doc.setFont(font, 'normal');
      doc.setFontSize(tableFontSize);
      // Every table value, including Unit, is left aligned.
      doc.text(lines, cellX + 2, y + tableFontSize * 0.58 + 1.8, { align: 'left' });
      cellX += columnWidths[index];
    });
    y += height;
  }

  const noteHeight = 8;
  if (y + noteHeight > pageHeight - 10) {
    doc.addPage();
    y = MARGIN;
  }
  doc.setFont(font, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(23, 32, 51);
  doc.text(data.footerNote, pageWidth / 2, Math.max(y + 7, pageHeight - 14), {
    align: 'center',
    maxWidth: usableWidth
  });

  doc.setProperties({
    title: `${data.title} — ${data.periodLabel}${monthName ? ` (${monthName})` : ''}`,
    subject: 'Doctor duty roster',
    creator: 'DocTrack'
  });

  return doc.output('blob');
}
