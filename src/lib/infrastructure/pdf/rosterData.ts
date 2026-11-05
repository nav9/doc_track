/**
 * PDF data preparation — pure and testable.
 *
 * The PDF is drawn from this prepared table, never from a screenshot of the
 * calendar. Long names/remarks are wrapped into multiple lines so nothing is
 * clipped on A4.
 */
import type { DutyRoster, RosterPdfOptions } from '../../domain/roster/types';
import { formatDate, daysInMonth, SHORT_DAY_NAMES, dayOfWeek, toTimeLabel } from '../../domain/common/dates';

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

function timeRange(start: string, end: string, crossesMidnight: boolean): string {
  return `${toTimeLabel(start, '24h')} – ${toTimeLabel(end, '24h')}${crossesMidnight ? ' (+1 day)' : ''}`;
}

export function prepareRosterPdfData(
  roster: DutyRoster,
  options: RosterPdfOptions,
  generatedOn: string
): RosterPdfData {
  const columns: PdfColumn[] = [
    { key: 'sl', label: 'Sl.', width: 8, align: 'center' },
    { key: 'date', label: 'Date', width: 18 }
  ];
  if (options.showDutyType) columns.push({ key: 'type', label: 'Duty', width: 14 });
  columns.push({ key: 'doctor', label: 'Doctor', width: 30 });
  if (options.showEmployeeId) columns.push({ key: 'employeeId', label: 'Employee ID', width: 16 });
  if (options.showDepartment) columns.push({ key: 'department', label: 'Department', width: 18 });
  if (options.showUnit) columns.push({ key: 'unit', label: 'Unit', width: 12 });
  columns.push({ key: 'time', label: 'Time', width: 20 });
  if (options.showRemarks) columns.push({ key: 'remarks', label: 'Remarks', width: 26 });

  const sorted = [...roster.entries].sort((a, b) => a.date.localeCompare(b.date));
  const rows: PdfRow[] = sorted.map((entry, index) => ({
    isWeekend: [0, 6].includes(dayOfWeek(entry.date)),
    cells: {
      sl: String(index + 1),
      date: `${formatDate(entry.date, options.dateFormat)} (${SHORT_DAY_NAMES[dayOfWeek(entry.date)]})`,
      type: entry.dutyType.charAt(0).toUpperCase() + entry.dutyType.slice(1),
      doctor: entry.doctorName,
      employeeId: entry.employeeId,
      department: entry.department,
      unit: entry.unit,
      time: timeRange(entry.startTime, entry.endTime, entry.startTime >= entry.endTime),
      remarks:
        [entry.remarks, entry.swapNote ? `Swap: ${entry.swapNote}` : ''].filter(Boolean).join('; ') ||
        '—'
    }
  }));

  const monthDays = daysInMonth(roster.year, roster.month);
  const uncovered = Array.from({ length: monthDays }, (_, index) => index + 1)
    .filter((day) => {
      const date = `${roster.year}-${String(roster.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return !sorted.some((entry) => entry.date === date);
    });

  return {
    title: options.title || roster.title,
    subtitle: roster.title && roster.title !== options.title ? roster.title : '',
    hospital: roster.hospitalName,
    department: roster.department,
    unit: roster.unit,
    periodLabel: `${MONTH_NAMES[roster.month - 1]} ${roster.year}`,
    generatedOn,
    columns,
    rows,
    footerNote:
      uncovered.length > 0
        ? `${uncovered.length} day(s) in this month have no roster entry.`
        : 'Every day in this month has a roster entry.',
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
