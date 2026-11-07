import { describe, expect, it } from 'vitest';
import { parseFriendlyDate, parseWhatsAppShares } from './parse';

describe('Multi User WhatsApp parser', () => {
  it('parses a labelled doctor share with a leave range', () => {
    const [record] = parseWhatsAppShares(
      `Dr. Asha Rao
Employee ID: MC-101
Department: Orthopaedics
Designation: Senior Resident
Speciality: Joint Replacement
Unit: Unit II
Leave: 10 Nov 2026 to 12 Nov 2026
Leave type: CL
Leave status: Approved
Reason: Family function`,
      '2026-11-05'
    );
    expect(record.name).toBe('Dr. Asha Rao');
    expect(record.employeeId).toBe('MC-101');
    expect(record.speciality).toBe('Joint Replacement');
    expect(record.leave).toMatchObject({
      startDate: '2026-11-10',
      endDate: '2026-11-12',
      category: 'CL',
      status: 'approved'
    });
  });

  it('parses a comma-separated row and separate leave dates', () => {
    const [record] = parseWhatsAppShares(
      'Dr. Ravi, MC-202, Medicine, Assistant Professor, Cardiology, Unit III\nLeave from: 01/12/2026\nLeave to: 03/12/2026',
      '2026-11-05'
    );
    expect(record.name).toBe('Dr. Ravi');
    expect(record.unit).toBe('Unit III');
    expect(record.leave?.startDate).toBe('2026-12-01');
    expect(record.leave?.endDate).toBe('2026-12-03');
  });

  it('reads friendly dates and warns about missing identifiers', () => {
    expect(parseFriendlyDate('1st Nov 26', '2026-11-05')).toBe('2026-11-01');
    expect(parseFriendlyDate('15/12/2026', '2026-11-05')).toBe('2026-12-15');
    const [record] = parseWhatsAppShares('Name: Dr. No ID', '2026-11-05');
    expect(record.warnings).toContain('Employee ID is missing; match only by name.');
  });
});