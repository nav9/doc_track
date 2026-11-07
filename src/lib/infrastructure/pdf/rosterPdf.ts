/**
 * A4 duty roster PDF generated entirely on the client with jsPDF.
 *
 * The table is drawn as vector text (never a screenshot), with:
 *  - hospital / department / unit header
 *  - month and year
 *  - wrapped names and remarks
 *  - page numbers when the roster spans pages
 *  - a signature and approval block on the final page
 *  - a generated-on line
 */
import { jsPDF } from 'jspdf';
import type { RosterPdfData, PdfColumn } from './rosterData';

const MARGIN = 14;
const LINE = 5;
const FONT = 'helvetica';

function textWidth(doc: jsPDF, text: string, size: number, weight: 'normal' | 'bold'): number {
  doc.setFont(FONT, weight);
  doc.setFontSize(size);
  return doc.getTextWidth(text);
}

function wrap(doc: jsPDF, text: string, width: number, size: number, weight: 'normal' | 'bold' = 'normal'): string[] {
  doc.setFont(FONT, weight);
  doc.setFontSize(size);
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (doc.getTextWidth(candidate) <= width || !current) {
      current = candidate;
    } else {
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

  let pageNumber = 1;
  const addPageFooter = () => {
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(110, 118, 132);
    doc.text(`Generated on ${data.generatedOn}`, MARGIN, pageHeight - 8);
    doc.text(`Page ${pageNumber}`, pageWidth - MARGIN, pageHeight - 8, { align: 'right' });
    doc.setTextColor(23, 32, 51);
  };

  const drawHeader = () => {
    doc.setTextColor(23, 32, 51);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(14);
    doc.text(data.departmentHeading, pageWidth / 2, MARGIN + 1, {
      align: 'center',
      maxWidth: usableWidth
    });
    doc.setFontSize(11);
    doc.text(data.rosterHeading, pageWidth / 2, MARGIN + 10, {
      align: 'center',
      maxWidth: usableWidth
    });
  };

  let y = MARGIN + 22;
  drawHeader();

  const drawTableHeader = () => {
    const height = 7;
    doc.setFillColor(234, 241, 255);
    doc.rect(MARGIN, y, usableWidth, height, 'F');
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8);
    let x = MARGIN;
    data.columns.forEach((column, index) => {
      doc.text(column.label, x + columnWidths[index] / 2, y + 4.6, { align: 'center' });
      x += columnWidths[index];
    });
    y += height;
  };

  drawTableHeader();

  doc.setFont(FONT, 'normal');
  doc.setFontSize(8);

  for (const row of data.rows) {
    const wrappedCells = data.columns.map((column, index) =>
      wrap(doc, row.cells[column.key] ?? '', columnWidths[index] - 3, 8)
    );
    const rowHeight = Math.max(6, Math.max(...wrappedCells.map((lines) => lines.length)) * 3.8 + 2.2);

    if (y + rowHeight > pageHeight - 24) {
      addPageFooter();
      doc.addPage();
      pageNumber += 1;
      y = MARGIN;
      drawHeader();
      y = MARGIN + 22;
      drawTableHeader();
    }

    if (row.isWeekend) {
      doc.setFillColor(248, 250, 252);
      doc.rect(MARGIN, y, usableWidth, rowHeight, 'F');
    }
    doc.setDrawColor(226, 232, 240);
    doc.line(MARGIN, y + rowHeight, MARGIN + usableWidth, y + rowHeight);

    let x = MARGIN;
    wrappedCells.forEach((lines, index) => {
      const column: PdfColumn = data.columns[index];
      const align = column.align ?? 'left';
      const textX = align === 'center' ? x + columnWidths[index] / 2 : x + 1.5;
      doc.text(lines, textX, y + 4, { align: align === 'center' ? 'center' : 'left' });
      x += columnWidths[index];
    });
    y += rowHeight;
  }

  // The prescribed note sits below the table, centred in the normal font.
  if (y > pageHeight - 92) {
    addPageFooter();
    doc.addPage();
    pageNumber += 1;
    y = MARGIN;
  }
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(23, 32, 51);
  const noteY = Math.min(Math.max(y + 9, pageHeight - 84), pageHeight - 76);
  doc.text(data.footerNote, pageWidth / 2, noteY, {
    align: 'center',
    maxWidth: usableWidth
  });

  if (data.showSignatureBlock) {
    const signatureY = pageHeight - 62;
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, signatureY + 18, MARGIN + 55, signatureY + 18);
    doc.line(pageWidth - MARGIN - 60, signatureY + 18, pageWidth - MARGIN, signatureY + 18);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.text('Signature of the undersigned', MARGIN, signatureY + 23);
    doc.text('Signature / Stamp of HOD', pageWidth - MARGIN - 60, signatureY + 23);
  }

  addPageFooter();
  doc.setProperties({
    title: `${data.title} — ${data.periodLabel}${monthName ? ` (${monthName})` : ''}`,
    subject: 'Doctor duty roster',
    creator: 'DocTrack'
  });

  return doc.output('blob');
}
