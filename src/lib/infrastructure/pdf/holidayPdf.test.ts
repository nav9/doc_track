import { describe, expect, it } from 'vitest';
import type { Holiday } from '../../domain/calendar/holidays';
import { generateHolidayPdf } from './holidayPdf';

const holiday = (
  id: string,
  date: string,
  name: string,
  kind: 'GH' | 'RH'
): Holiday => ({
  id,
  year: Number(date.slice(0, 4)),
  date,
  name,
  kind,
  source: 'manual',
  notes: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
});

describe('holiday PDF', () => {
  it('produces a real PDF with general and restricted holidays', async () => {
    const blob = generateHolidayPdf(2026, [
      holiday('holiday_1', '2026-01-26', 'Republic Day', 'GH'),
      holiday('holiday_2', '2026-03-04', 'Holi', 'RH')
    ]);

    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(1000);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.slice(0, 5)).toBe('%PDF-');
    expect(text.match(/\/Type\s*\/Page\b/g) ?? []).toHaveLength(1);
  });
});
