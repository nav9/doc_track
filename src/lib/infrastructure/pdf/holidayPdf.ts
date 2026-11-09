/**
 * A4 holiday list generated on the client with jsPDF.
 *
 * The table uses a portrait layout with repeating column headers. Restricted
 * holidays (RH) are highlighted with a warm row tint and a stronger type cell so
 * they stand apart from general holidays (GH) when the list is printed.
 */
import { jsPDF } from 'jspdf';
import type { Holiday } from '../../domain/calendar/holidays';

const MARGIN = 16;
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const USABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;
const COLUMN_WIDTHS = [32, 25, 95, 26];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dateParts(iso: string): [number, number, number] {
  return iso.split('-').map(Number) as [number, number, number];
}

function dateLabel(iso: string): string {
  const [year, month, day] = dateParts(iso);
  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1] ?? ''} ${year}`;
}

function weekdayLabel(iso: string): string {
  const [year, month, day] = dateParts(iso);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? '';
}

function wrap(doc: jsPDF, text: string, width: number, size: number): string[] {
  doc.setFont('helvetica', 'normal');
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

export function generateHolidayPdf(year: number, holidays: Holiday[]): Blob {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  });
  const headerHeight = 9;
  const tableFontSize = 9;
  const rowFloor = 8.5;
  const bottomLimit = PAGE_HEIGHT - 22;

  const drawHeader = (top: number) => {
    doc.setFillColor(37, 64, 120);
    doc.rect(MARGIN, top, USABLE_WIDTH, headerHeight, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    let x = MARGIN;
    ['DATE', 'DAY', 'HOLIDAY', 'TYPE'].forEach((label, index) => {
      doc.text(label, x + 3, top + 5.8);
      x += COLUMN_WIDTHS[index];
    });
  };

  doc.setTextColor(23, 32, 51);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(`HOLIDAY LIST FOR THE YEAR ${year}`, PAGE_WIDTH / 2, MARGIN + 2, {
    align: 'center'
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(71, 85, 105);
  doc.text('General Holidays (GH) and Restricted Holidays (RH)', PAGE_WIDTH / 2, MARGIN + 9, {
    align: 'center'
  });

  let y = MARGIN + 17;
  drawHeader(y);
  y += headerHeight;

  const sorted = holidays
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  for (const holiday of sorted) {
    const holidayLines = wrap(
      doc,
      holiday.name,
      COLUMN_WIDTHS[2] - 6,
      tableFontSize
    );
    const height = Math.max(rowFloor, holidayLines.length * 4.4 + 4);

    if (y + height > bottomLimit) {
      doc.addPage();
      y = MARGIN;
      drawHeader(y);
      y += headerHeight;
    }

    const restricted = holiday.kind === 'RH';
    doc.setFillColor(255, restricted ? 245 : 255, restricted ? 222 : 255);
    doc.rect(MARGIN, y, USABLE_WIDTH, height, 'F');

    if (restricted) {
      doc.setFillColor(247, 190, 62);
      doc.rect(MARGIN + COLUMN_WIDTHS[0] + COLUMN_WIDTHS[1] + COLUMN_WIDTHS[2], y, COLUMN_WIDTHS[3], height, 'F');
    }

    let x = MARGIN;
    for (const width of COLUMN_WIDTHS) {
      doc.setDrawColor(206, 214, 226);
      doc.setLineWidth(0.2);
      doc.rect(x, y, width, height);
      x += width;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(tableFontSize);
    doc.setTextColor(23, 32, 51);
    doc.text(dateLabel(holiday.date), MARGIN + 3, y + tableFontSize * 0.55 + 2);
    doc.text(
      weekdayLabel(holiday.date),
      MARGIN + COLUMN_WIDTHS[0] + 3,
      y + tableFontSize * 0.55 + 2
    );
    doc.text(
      holidayLines,
      MARGIN + COLUMN_WIDTHS[0] + COLUMN_WIDTHS[1] + 3,
      y + tableFontSize * 0.55 + 2
    );

    const typeX =
      MARGIN + COLUMN_WIDTHS[0] + COLUMN_WIDTHS[1] + COLUMN_WIDTHS[2] + COLUMN_WIDTHS[3] / 2;
    doc.setFont('helvetica', 'bold');
    if (restricted) doc.setTextColor(92, 48, 0);
    doc.text(holiday.kind, typeX, y + tableFontSize * 0.55 + 2, { align: 'center' });
    doc.setTextColor(23, 32, 51);

    y += height;
  }

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(206, 214, 226);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, PAGE_HEIGHT - 17, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 17);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text('RH = Restricted Holiday     GH = General Holiday', MARGIN, PAGE_HEIGHT - 11);
    doc.text(`Page ${page} of ${totalPages}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 11, {
      align: 'right'
    });
  }

  doc.setProperties({
    title: `Holiday List for the Year ${year}`,
    subject: `General and restricted holidays for ${year}`,
    creator: 'DocTrack'
  });

  return doc.output('blob');
}
