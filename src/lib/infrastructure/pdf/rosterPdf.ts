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
    doc.setFont(FONT, 'bold');
    doc.setFontSize(15);
    doc.text(data.hospital || 'Doctor Duty Roster', MARGIN, MARGIN + 2);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(9);
    const details = [data.department, data.unit].filter(Boolean).join(' · ');
    if (details) doc.text(details, MARGIN, MARGIN + 8);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(12);
    doc.text(data.title, pageWidth / 2, MARGIN + 17, { align: 'center' });
    doc.setFont(FONT, 'normal');
    doc.setFontSize(10);
    doc.text(data.periodLabel, pageWidth / 2, MARGIN + 23, { align: 'center' });
    if (data.subtitle) {
      doc.setFontSize(8);
      doc.text(data.subtitle, pageWidth / 2, MARGIN + 28, { align: 'center' });
    }
  };

  let y = MARGIN + 34;
  drawHeader();

  const drawTableHeader = () => {
    const height = 7;
    doc.setFillColor(234, 241, 255);
    doc.rect(MARGIN, y, usableWidth, height, 'F');
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8);
    let x = MARGIN;
    data.columns.forEach((column, index) => {
      doc.text(column.label, x + 1.5, y + 4.6);
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
      y = MARGIN + 34;
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

  // Footer note and signature block on the final page.
  doc.setFont(FONT, 'italic');
  doc.setFontSize(8);
  doc.setTextColor(104, 117, 138);
  y += 4;
  doc.text(data.footerNote, MARGIN, y, { maxWidth: usableWidth });
  doc.setTextColor(23, 32, 51);

  if (data.showSignatureBlock) {
    const blockHeight = 34;
    if (y + blockHeight > pageHeight - 18) {
      addPageFooter();
      doc.addPage();
      pageNumber += 1;
      y = MARGIN;
    }
    y = Math.min(Math.max(y + 12, pageHeight - 60), pageHeight - blockHeight - 12);
    doc.setDrawColor(203, 213, 225);
    doc.line(MARGIN, y, MARGIN + 55, y);
    doc.line(pageWidth - MARGIN - 55, y, pageWidth - MARGIN, y);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.text('Prepared by (Signature / Date)', MARGIN, y + 4);
    doc.text('Approved by HOD / HR (Signature / Stamp)', pageWidth - MARGIN - 55, y + 4);
  }

  addPageFooter();
  doc.setProperties({
    title: `${data.title} — ${data.periodLabel}${monthName ? ` (${monthName})` : ''}`,
    subject: 'Doctor duty roster',
    creator: 'DocTrack'
  });

  return doc.output('blob');
}
