/**
 * Plain-text doctor/leave parser for messages copied out of WhatsApp.
 *
 * It accepts a labelled block (Name:, Employee ID:, Leave:) or a single
 * comma/pipe separated row. Dates may be written as 10 Nov 2026, 10/11/2026 or
 * 2026-11-10; a missing year uses the current year.
 */
import type { ISODate } from '../common/types';
import { isISODate } from '../common/types';
import { MONTH_NAMES, SHORT_MONTH_NAMES, toISODate } from '../common/dates';
import type { LeaveStatus } from '../leave/types';

export interface ParsedSharedLeave {
  startDate: ISODate;
  endDate: ISODate;
  category: string;
  status: LeaveStatus;
  reason: string;
}

export interface ParsedDoctorShare {
  name: string;
  employeeId: string;
  department: string;
  designation: string;
  speciality: string;
  unit: string;
  contactPhone: string;
  leave: ParsedSharedLeave | null;
  warnings: string[];
}

const ALIASES: Record<string, string> = {
  name: 'name',
  doctor: 'name',
  'doctor name': 'name',
  'employee id': 'employeeId',
  'employee no': 'employeeId',
  'employee number': 'employeeId',
  'emp id': 'employeeId',
  'emp no': 'employeeId',
  'staff id': 'employeeId',
  department: 'department',
  dept: 'department',
  designation: 'designation',
  role: 'designation',
  speciality: 'speciality',
  specialty: 'speciality',
  unit: 'unit',
  phone: 'contactPhone',
  mobile: 'contactPhone',
  contact: 'contactPhone',
  'phone number': 'contactPhone',
  leave: 'leavePeriod',
  'leave dates': 'leavePeriod',
  'leave period': 'leavePeriod',
  'leave from': 'leaveFrom',
  from: 'leaveFrom',
  'leave to': 'leaveTo',
  to: 'leaveTo',
  'leave status': 'leaveStatus',
  status: 'leaveStatus',
  'leave type': 'category',
  category: 'category',
  type: 'category',
  reason: 'reason',
  note: 'notes',
  notes: 'notes'
};

const MONTHS = new Map<string, number>();
MONTH_NAMES.forEach((name, index) => MONTHS.set(name.toLowerCase(), index + 1));
SHORT_MONTH_NAMES.forEach((name, index) => MONTHS.set(name.toLowerCase(), index + 1));

function cleanLine(line: string): string {
  return line
    .replace(/^[\s*•●\-–—]+/, '')
    .replace(/\*+/g, '')
    .trim();
}

export function parseFriendlyDate(value: string, today: ISODate): ISODate | null {
  const text = value.trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
  if (isISODate(text)) return text;
  const working = String(text);
  const todayYear = Number(today.slice(0, 4));
  const todayMonth = Number(today.slice(5, 7));

  const numeric = working.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const rawYear = numeric[3];
    const year = rawYear ? (rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)) : todayYear;
    return checkedDate(year, month, day);
  }

  const named = working.match(/^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{2,4}))?$/);
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS.get(named[2].toLowerCase());
    const rawYear = named[3];
    const year = rawYear ? (rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)) : todayYear;
    if (month) return checkedDate(year, month, day);
  }

  if (/^\d{1,2}$/.test(working)) return checkedDate(todayYear, todayMonth, Number(working));
  return null;
}

function checkedDate(year: number, month: number, day: number): ISODate | null {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return null;
  }
  return toISODate(date);
}

function parseRange(value: string, today: ISODate): [ISODate | null, ISODate | null] {
  const parts = value
    .split(/\s+(?:to|until|till)\s+|\s*[–—]\s*|\s+-\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const start = parseFriendlyDate(parts[0] ?? '', today);
  const end = parseFriendlyDate(parts[1] ?? parts[0] ?? '', today);
  return [start, end];
}

function statusOf(value: string): LeaveStatus {
  const text = value.trim().toLowerCase();
  if (text.startsWith('approv')) return 'approved';
  if (text.startsWith('reject')) return 'rejected';
  if (text.startsWith('cancel')) return 'cancelled';
  if (text.startsWith('pend')) return 'pending';
  return 'planned';
}

export function parseWhatsAppShares(text: string, today: ISODate): ParsedDoctorShare[] {
  const blocks = text
    .replace(/\r/g, '')
    .split(/\n\s*(?:---+|===+)\s*\n|\n\s*\n+/)
    .map((block) => block.split('\n').map(cleanLine).filter(Boolean))
    .filter((lines) => lines.length > 0);
  const results: ParsedDoctorShare[] = [];

  for (const lines of blocks) {
    const fields: Record<string, string> = {};
    const extras: string[] = [];
    for (const line of lines) {
      const labelled = line.match(/^([A-Za-z][A-Za-z ]{1,30})\s*:\s*(.+)$/);
      if (labelled) {
        const key = ALIASES[labelled[1].trim().toLowerCase()];
        if (key) fields[key] = labelled[2].trim();
        else extras.push(line);
      } else if (!fields.name) {
        const row = line.split(/\s*[|;]\s*|\s*,\s*/).map((part) => part.trim()).filter(Boolean);
        if (row.length >= 2) {
          fields.name = row[0];
          fields.employeeId = row[1] ?? '';
          fields.department = row[2] ?? '';
          fields.designation = row[3] ?? '';
          fields.speciality = row[4] ?? '';
          fields.unit = row[5] ?? '';
        } else {
          fields.name = line;
        }
      } else if (!fields.notes) {
        fields.notes = line;
      }
    }

    const warnings: string[] = [];
    if (!fields.name) warnings.push('Doctor name is missing.');
    if (!fields.employeeId) warnings.push('Employee ID is missing; match only by name.');
    let start: ISODate | null = fields.leaveFrom ? parseFriendlyDate(fields.leaveFrom, today) : null;
    let end: ISODate | null = fields.leaveTo ? parseFriendlyDate(fields.leaveTo, today) : null;
    if (fields.leavePeriod) {
      const range = parseRange(fields.leavePeriod, today);
      start = start ?? range[0];
      end = end ?? range[1];
    }
    if ((fields.leaveFrom || fields.leaveTo || fields.leavePeriod) && (!start || !end)) {
      warnings.push('Leave dates could not be read; use 10 Nov 2026 or 2026-11-10.');
    }
    if (start && end && end < start) {
      warnings.push('Leave end date is before the start date.');
      end = start;
    }

    results.push({
      name: fields.name ?? '',
      employeeId: fields.employeeId ?? '',
      department: fields.department ?? '',
      designation: fields.designation ?? '',
      speciality: fields.speciality ?? '',
      unit: fields.unit ?? '',
      contactPhone: fields.contactPhone ?? '',
      leave:
        start && end
          ? {
              startDate: start,
              endDate: end,
              category: (fields.category || 'CL').toUpperCase(),
              status: statusOf(fields.leaveStatus || 'planned'),
              reason: fields.reason || fields.notes || ''
            }
          : null,
      warnings
    });
  }

  return results;
}