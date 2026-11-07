import { describe, expect, it } from 'vitest';
import { DEFAULT_ROSTER_PDF_OPTIONS } from '../../domain/roster/types';
import type { DutyRoster } from '../../domain/roster/types';
import { prepareRosterPdfData } from './rosterData';
import { generateRosterPdf } from './rosterPdf';

const roster: DutyRoster = {
  id: 'roster_test',
  profileId: 'profile_test',
  year: 2026,
  month: 11,
  title: 'Night Duty Roster',
  department: 'General Medicine',
  unit: 'Unit II',
  hospitalName: 'Medical College Hospital',
  entries: [
    {
      id: 'entry_1',
      date: '2026-11-11',
      doctorId: null,
      doctorName: 'Dr. Asha Rao',
      employeeId: 'MC-101',
      department: 'General Medicine',
      unit: 'Unit II',
      startTime: '09:00',
      endTime: '09:00',
      dutyType: 'night',
      remarks: 'First on call; handover to the day unit at 09:00.',
      swapNote: '',
      dutyId: null
    },
    {
      id: 'entry_2',
      date: '2026-11-12',
      doctorId: null,
      doctorName: 'Dr. Vikram Menon',
      employeeId: 'MC-102',
      department: 'General Medicine',
      unit: 'Unit II',
      startTime: '09:00',
      endTime: '09:00',
      dutyType: 'night',
      remarks: '',
      swapNote: '',
      dutyId: null
    }
  ],
  notes: '',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z'
};

describe('roster PDF', () => {
  it('prepares wrapped table data and produces a real PDF file', async () => {
    const data = prepareRosterPdfData(
      roster,
      { ...DEFAULT_ROSTER_PDF_OPTIONS, title: 'Night Duty Roster' },
      '05 Nov 2026'
    );

    expect(data.periodLabel).toBe('November 2026');
    expect(data.departmentHeading).toBe('DEPARTMENT OF GENERAL MEDICINE');
    expect(data.rosterHeading).toBe(
      "DOCTOR'S DUTY ROSTER FOR THE MONTH OF NOVEMBER 2026"
    );
    expect(data.rows).toHaveLength(2);
    expect(data.rows[0].cells.doctor).toBe('Dr. Asha Rao');
    expect(data.rows[0].cells.days).toBe('Wednesday');
    expect(data.rows[0].cells.unit).toBe('Unit II');
    expect(data.columns.map((column) => column.key)).toEqual([
      'date',
      'days',
      'unit',
      'doctor'
    ]);
    expect(data.footerNote).toBe(
      'Note: No alteration to be made without the permission of the undersigned'
    );

    const blob = generateRosterPdf(data, '11/2026');
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(1000);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
});
