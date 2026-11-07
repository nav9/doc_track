import type { AppServices } from '../application/services/appServices';
import { addDays } from '../domain/common/dates';

/**
 * Seeds a small, coherent dataset for `menu.py` option 4.
 * Existing data is never overwritten, so later visits keep the doctor's edits.
 */
export async function seedTestData(services: AppServices): Promise<boolean> {
  const snapshot = await services.snapshot();
  if (snapshot.profiles.length > 0) return false;

  const today = services.clock.today();
  await services.saveProfile(
    {
      prefix: 'Dr.',
      name: 'Asha Rao',
      employeeId: 'MC-2026-0142',
      department: 'General Medicine',
      designation: 'Senior Resident',
      speciality: 'Internal Medicine',
      unit: 'Unit II',
      hospitalName: 'Government Medical College Hospital',
      role: 'doctor',
      contactEmail: 'asha.rao@example.test',
      contactPhone: '+91 98765 43210',
      notes: 'Sample profile created by menu.py option 4.'
    },
    {
      employmentType: 'permanent',
      joiningDate: addDays(today, -180),
      organisationName: 'Government Medical College Hospital'
    }
  );

  const profile = (await services.snapshot()).profiles[0];
  if (!profile) throw new Error('Test profile could not be created.');

  await services.adjustLedger({
    category: 'EL',
    amount: 2,
    direction: 'credit',
    effectiveDate: today,
    reason: 'Test data — opening leave adjustment'
  });

  await services.saveEvent({
    title: 'Thesis protocol review',
    date: addDays(today, 7),
    endDate: null,
    type: 'academic',
    allDay: false,
    startTime: '10:00',
    endTime: '11:30',
    notes: 'Sample event created by menu.py option 4.'
  });

  for (const offset of [3, 2, 1]) {
    await services.setAttendance(addDays(today, -offset), 'confirmed', 'Sample attendance');
  }

  await services.saveRosterDoctor({
    name: 'Asha Rao',
    employeeId: 'MC-2026-0142',
    department: 'General Medicine',
    unit: 'Unit II',
    designation: 'Senior Resident',
    profileId: profile.id,
    notes: 'Sample roster doctor'
  });
  await services.saveRosterDoctor({
    name: 'Vikram Sen',
    employeeId: 'MC-2026-0188',
    department: 'General Medicine',
    unit: 'Unit I',
    designation: 'Junior Resident',
    profileId: null,
    notes: 'Sample roster doctor'
  });

  return true;
}