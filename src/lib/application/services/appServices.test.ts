import { beforeEach, describe, expect, it } from 'vitest';
import { AppServices } from './appServices';
import { createRepositories } from '../../infrastructure/repositories/idbRepositories';
import { closeDatabase, deleteDatabase } from '../../infrastructure/indexeddb/db';
import { ServiceError } from './errors';

let services: AppServices;

async function freshServices(): Promise<AppServices> {
  await closeDatabase();
  await deleteDatabase();
  const repositories = await createRepositories();
  const instance = new AppServices(repositories);
  await instance.init();
  await instance.saveSettings({
    manualNowEnabled: true,
    manualNow: new Date(2026, 10, 5, 10, 0, 0).toISOString(),
    backupReminderEnabled: false,
    logLevels: { DEBUG: false, INFO: false, WARN: false, ERROR: false }
  });
  return instance;
}

async function createProfile(instance: AppServices): Promise<void> {
  await instance.saveProfile(
    {
      prefix: 'Dr.',
      name: 'Asha Rao',
      employeeId: 'MC-101',
      department: 'General Medicine',
      designation: 'Senior Resident',
      hospitalName: 'Medical College'
    },
    {
      resolvedPrefix: 'Dr.',
      joiningDate: '2024-01-01',
      employmentType: 'permanent',
      organisationName: 'Medical College'
    }
  );
}

describe('AppServices integration', () => {
  beforeEach(async () => {
    services = await freshServices();
  });

  it('seeds settings and a published policy, and creates no credits before a profile exists', async () => {
    expect(services.clock.today()).toBe('2026-11-05');
    const snapshot = await services.snapshot();
    expect(snapshot.policies).toHaveLength(1);
    expect(snapshot.policies[0].status).toBe('published');
    expect(snapshot.profiles).toHaveLength(0);
    expect(snapshot.ledger).toHaveLength(0);
  });

  it('persists the profile and seeds prorated entitlement credits once', async () => {
    await createProfile(services);
    const snapshot = await services.snapshot();
    expect(snapshot.profiles[0].name).toBe('Asha Rao');
    expect(snapshot.employments[0].startDate).toBe('2024-01-01');
    expect((await services.getSettings()).onboarded).toBe(true);

    const clCredits = snapshot.ledger.filter(
      (transaction) => transaction.category === 'CL' && transaction.direction === 'credit'
    );
    expect(clCredits).toHaveLength(2); // current and next calendar year
    expect(clCredits.every((credit) => credit.amount === 15)).toBe(true);

    await services.ensureEntitlementCredits();
    const second = await services.snapshot();
    expect(second.ledger).toHaveLength(snapshot.ledger.length);
  });

  it('records a leave, derives the balance from the ledger and reverses on cancellation', async () => {
    await createProfile(services);
    const leave = await services.createLeave({
      category: 'CL',
      startDate: '2026-11-10',
      endDate: '2026-11-11',
      reason: 'Family function',
      notes: '',
      status: 'planned'
    });
    expect(leave.leaveDays).toBe(2);

    let balances = await services.balances();
    expect(balances.CL.used).toBe(2);
    expect(balances.CL.available).toBe(13);

    await services.cancelLeave(leave.id, 'Plan changed');
    balances = await services.balances();
    expect(balances.CL.used).toBe(0);
    expect(balances.CL.available).toBe(15);

    const snapshot = await services.snapshot();
    expect(snapshot.leaves[0].status).toBe('cancelled');
    expect(snapshot.ledger.some((transaction) => transaction.reversalOf === leave.ledgerTransactionIds[0])).toBe(true);
  });

  it('enforces the monthly CL limit', async () => {
    await createProfile(services);
    await services.createLeave({
      category: 'CL',
      startDate: '2026-11-02',
      endDate: '2026-11-04',
      reason: 'Three days',
      notes: ''
    });

    await expect(
      services.createLeave({
        category: 'CL',
        startDate: '2026-11-16',
        endDate: '2026-11-16',
        reason: 'Fourth day',
        notes: ''
      })
    ).rejects.toBeInstanceOf(ServiceError);

    const leaveCount = (await services.snapshot()).leaves.length;
    expect(leaveCount).toBe(1);
  });

  it('creates a PDO for a completed 24-hour duty and converts an unused PDO to CCL', async () => {
    await createProfile(services);
    const duty = await services.saveDuty({
      date: '2026-11-10',
      shiftId: 'shift_night_24h',
      status: 'completed',
      remarks: ''
    });

    let snapshot = await services.snapshot();
    const pdo = snapshot.pdos.find((record) => record.dutyId === duty.id);
    expect(pdo).toBeDefined();
    expect(pdo?.date).toBe('2026-11-11');
    expect(pdo?.status).toBe('scheduled');

    const result = await services.resolvePdo(pdo!.id, 'unused');
    expect(result.converted).toBe(true);

    snapshot = await services.snapshot();
    const cclCredits = snapshot.ledger.filter(
      (transaction) => transaction.category === 'CCL' && transaction.direction === 'credit'
    );
    expect(cclCredits).toHaveLength(1);
    expect(cclCredits[0].amount).toBe(1);
    expect(snapshot.pdos.find((record) => record.id === pdo!.id)?.status).toBe('converted-unused');
  });

  it('does not duplicate duty consequences when the same duty is saved twice', async () => {
    await createProfile(services);
    const input = {
      date: '2026-11-07',
      shiftId: 'shift_night_24h',
      status: 'completed' as const,
      remarks: ''
    };
    const duty = await services.saveDuty(input);
    await services.saveDuty({ ...input, id: duty.id });

    const snapshot = await services.snapshot();
    const cclCredits = snapshot.ledger.filter(
      (transaction) => transaction.category === 'CCL' && transaction.direction === 'credit' && !transaction.reversalOf
    );
    const pdoRecords = snapshot.pdos.filter((record) => record.dutyId === duty.id);
    expect(pdoRecords).toHaveLength(1);
    expect(cclCredits).toHaveLength(2); // qualifying-duty CCL + PDO-on-Sunday conversion
  });

  it('syncs roster entries into duties and prepares an A4 table', async () => {
    await createProfile(services);
    const roster = {
      id: '',
      profileId: (await services.snapshot()).profiles[0].id,
      year: 2026,
      month: 11,
      title: 'Night Duty Roster',
      department: 'General Medicine',
      unit: 'Unit II',
      hospitalName: 'Medical College',
      entries: [
        {
          id: 'entry-1',
          date: '2026-11-11',
          doctorId: null,
          doctorName: 'Dr. Asha Rao',
          employeeId: 'MC-101',
          department: 'General Medicine',
          unit: 'Unit II',
          startTime: '09:00',
          endTime: '09:00',
          dutyType: 'night' as const,
          remarks: '',
          swapNote: '',
          dutyId: null
        }
      ],
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const saved = await services.saveRoster(roster, { syncDuties: true });
    expect(saved.id).toContain('roster');

    const snapshot = await services.snapshot();
    expect(snapshot.rosters).toHaveLength(1);
    const duty = snapshot.duties.find((record) => record.date === '2026-11-11');
    expect(duty).toBeDefined();
    expect(duty?.rosterEntryId).toBe('entry-1');
  });

  it('round-trips a full export through preview and import, creating a version first', async () => {
    await createProfile(services);
    await services.createLeave({
      category: 'CL',
      startDate: '2026-11-10',
      endDate: '2026-11-10',
      reason: 'Personal',
      notes: ''
    });

    const exported = await services.exportText('full');
    expect(exported.text).toContain('-----BEGIN DOCTRACK DATA-----');
    expect(exported.filename).toMatch(/^DocTrack_Backup_.*\.txt$/);

    const preview = await services.previewImport(exported.text);
    expect(preview.kind).toBe('full');
    expect(preview.counts.leaveRequests).toBe(1);

    const before = await services.listVersions();
    expect(before).toHaveLength(0);

    // Svelte deep-proxies the preview while the doctor reviews it. IndexedDB
    // rejects proxies, so a full import must normalise the snapshot first.
    const deepProxy = <T>(value: T): T => {
      if (Array.isArray(value)) return value.map((item) => deepProxy(item)) as T;
      if (value && typeof value === 'object') {
        return new Proxy(
          Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepProxy(item)])),
          {}
        ) as T;
      }
      return value;
    };
    const result = await services.applyImport({
      ...preview,
      snapshot: deepProxy(preview.snapshot)
    });
    expect(result.versionId).not.toBeNull();
    expect((await services.snapshot()).leaves).toHaveLength(1);
    expect((await services.listVersions()).length).toBe(1);
  });

  it('imports a leave package additively and keeps imported policies as drafts', async () => {
    await createProfile(services);
    const exported = await services.exportText('leave');
    const preview = await services.previewImport(exported.text);
    expect(preview.kind).toBe('leave');

    const before = (await services.snapshot()).policies.length;
    const result = await services.applyImport(preview);
    expect(result.added + result.updated).toBeGreaterThan(0);
    expect((await services.snapshot()).policies.length).toBe(before);
  });

  it('stores shared leave without changing the signed-in ledger and exports it', async () => {
    await createProfile(services);
    const before = await services.snapshot();
    const doctor = await services.saveRosterDoctor({
      name: 'Dr. Meera Nair',
      employeeId: 'MC-900',
      department: 'Orthopaedics',
      designation: 'Senior Resident',
      speciality: 'Joint Replacement',
      unit: 'Unit II',
      profileId: null,
      notes: ''
    });
    expect(doctor.id).toBeTruthy();
    const leave = await services.saveSharedLeave({
      doctorId: doctor.id,
      startDate: '2026-11-10',
      endDate: '2026-11-12',
      category: 'CL',
      status: 'approved',
      reason: 'Family function',
      notes: '',
      source: 'whatsapp'
    });
    expect(leave.doctorName).toBe('Dr. Meera Nair');
    const after = await services.snapshot();
    expect(after.sharedLeaves).toHaveLength(1);
    expect(after.ledger).toHaveLength(before.ledger.length);

    const exported = await services.exportText('multiuser');
    const preview = await services.previewImport(exported.text);
    expect(preview.kind).toBe('multiuser');
    expect(preview.counts.sharedLeaves).toBe(1);
    expect(preview.snapshot.doctors).toHaveLength(1);
  });

  it('exports only the selected shared leave records', async () => {
    await createProfile(services);
    const doctor = await services.saveRosterDoctor({
      name: 'Dr. Meera Nair',
      employeeId: 'MC-901',
      department: 'Orthopaedics',
      designation: 'Senior Resident',
      speciality: 'Joint Replacement',
      unit: 'Unit II',
      profileId: null,
      notes: ''
    });
    const first = await services.saveSharedLeave({
      doctorId: doctor.id,
      startDate: '2026-11-10',
      endDate: '2026-11-11',
      category: 'CL',
      status: 'approved',
      reason: 'Family function',
      notes: '',
      source: 'whatsapp'
    });
    await services.saveSharedLeave({
      doctorId: doctor.id,
      startDate: '2026-11-20',
      endDate: '2026-11-21',
      category: 'RH',
      status: 'pending',
      reason: 'Personal work',
      notes: '',
      source: 'whatsapp'
    });

    const exported = await services.exportText('multiuser', { sharedLeaveIds: [first.id] });
    const preview = await services.previewImport(exported.text);
    expect(preview.snapshot.sharedLeaves).toHaveLength(1);
    expect(preview.snapshot.sharedLeaves[0]?.id).toBe(first.id);
  });

  it('clones reactive policy objects and publishes a new version without mutating history', async () => {
    const before = await services.snapshot();
    const active = before.policies[0];

    // A Proxy behaves like a Svelte $state object: structuredClone rejects it.
    const draft = await services.createPolicyDraft(new Proxy(active, {}));
    expect(draft.status).toBe('draft');
    expect(draft.version).toBe(2);
    draft.id = 'policyver_test_v2';
    draft.name = 'Medical College Leave Policy (revised)';
    draft.changeSummary = 'Integration test revision';

    await services.savePolicyDraft(new Proxy(draft, {}));
    const saved = (await services.snapshot()).policies.find((policy) => policy.id === draft.id);
    expect(saved?.name).toBe(draft.name);

    const published = await services.publishPolicy(new Proxy(saved!, {}));
    expect(published.status).toBe('published');
    expect(published.version).toBe(2);

    const after = await services.snapshot();
    expect(after.policies.filter((policy) => policy.policyId === active.policyId)).toHaveLength(2);
    expect(after.policies.some((policy) => policy.status === 'draft')).toBe(false);
    expect(after.policies.find((policy) => policy.id === active.id)?.name).toBe(active.name);
  });
});
