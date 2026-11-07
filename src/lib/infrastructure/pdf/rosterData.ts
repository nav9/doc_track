/**
 * PDF data preparation — pure and testable.
 *
 * The PDF is drawn from this prepared table, never from a screenshot of the
 * calendar. Long names/remarks are wrapped into multiple lines so nothing is
 * clipped on A4.
 */
import type { DutyRoster, RosterPdfOptions } from '../../domain/roster/types';
import { formatDate, DAY_NAMES, dayOfWeek } from '../../domain/common/dates';
import { unitLabel } from '../../domain/roster/schedule';

export interface PdfColumn {
  key: string;
  label: string;
  width: number;
  align?: 'left' | 'center';
}

export interface PdfRow {
  cells: Record<string, string>;
  isWeekend: boolean;
}

export interface RosterPdfData {
  title: string;
  subtitle: string;
  hospital: string;
  department: string;
  unit: string;
  departmentHeading: string;
  rosterHeading: string;
  periodLabel: string;
  generatedOn: string;
  columns: PdfColumn[];
  rows: PdfRow[];
  footerNote: string;
  showSignatureBlock: boolean;
  orientation: 'portrait' | 'landscape';
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

export function prepareRosterPdfData(
  roster: DutyRoster,
  options: RosterPdfOptions,
  generatedOn: string
): RosterPdfData {
  const columns: PdfColumn[] = [
    { key: 'date', label: 'DATE', width: 28 },
    { key: 'days', label: 'DAYS', width: 25 },
    { key: 'unit', label: 'UNIT', width: 16, align: 'center' },
    { key: 'doctor', label: "DOCTOR'S NAME", width: 45 }
  ];

  const sorted = [...roster.entries].sort((a, b) => a.date.localeCompare(b.date));
  const rows: PdfRow[] = sorted.map((entry) => ({
    isWeekend: [0, 6].includes(dayOfWeek(entry.date)),
    cells: {
      date: formatDate(entry.date, options.dateFormat),
      days: DAY_NAMES[dayOfWeek(entry.date)],
      unit: entry.unit || unitLabel(entry.unitNumber ?? 0, roster.unitStyle ?? 'roman'),
      doctor: entry.doctorName
    }
  }));

  const periodLabel = `${MONTH_NAMES[roster.month - 1]} ${roster.year}`;
  return {
    title: options.title || roster.title,
    subtitle: '',
    hospital: roster.hospitalName,
    department: roster.department,
    unit: roster.unit,
    departmentHeading: `DEPARTMENT OF ${(roster.department || '').toUpperCase()}`.trim(),
    rosterHeading: `DOCTOR'S DUTY ROSTER FOR THE MONTH OF ${periodLabel.toUpperCase()}`,
    periodLabel,
    generatedOn,
    columns,
    rows,
    footerNote: 'Note: No alteration to be made without the permission of the undersigned',
    showSignatureBlock: options.showSignatureBlock,
    orientation: options.orientation
  };
}

/** Text preview used on screen before downloading the real PDF. */
export function rosterPreviewLines(data: RosterPdfData): string[][] {
  return [
    data.columns.map((column) => column.label),
    ...data.rows.map((row) => data.columns.map((column) => row.cells[column.key] ?? ''))
  ];
}
