<script lang="ts">
  import { untrack } from 'svelte';
  import { Download } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Select from '../lib/components/ui/Select.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import { downloadText } from '../lib/infrastructure/files/files';
  import { countSnapshot } from '../lib/application/dto/snapshot';
  import { NAME_PREFIXES, USER_ROLES } from '../lib/domain/profile/profile';
  import type { EmploymentRecord, ProfileDraft, UserRole } from '../lib/domain/profile/profile';
  import { formatDate } from '../lib/domain/common/dates';
  import { titleCase } from '../lib/app/ui';

  interface AccountForm {
    prefix: string;
    name: string;
    employeeId: string;
    department: string;
    designation: string;
    speciality: string;
    unit: string;
    hospitalName: string;
    role: UserRole;
    contactEmail: string;
    contactPhone: string;
    notes: string;
  }

  const profile = $derived(app.profile);
  const employment = $derived(app.employment);
  const counts = $derived(countSnapshot(app.snapshot));

  // The form is a working copy: it is seeded once from the saved profile and
  // only written back when the doctor presses Save. untrack makes that
  // intentional one-time snapshot explicit (Svelte otherwise warns).
  let customPrefix = $state(
    untrack(() =>
      profile && !(NAME_PREFIXES as readonly string[]).includes(profile.prefix)
        ? profile.prefix
        : ''
    )
  );
  let draft = $state<AccountForm>(
    untrack(() => ({
      prefix:
        profile && (NAME_PREFIXES as readonly string[]).includes(profile.prefix)
          ? profile.prefix
          : 'Other',
      name: profile?.name ?? '',
      employeeId: profile?.employeeId ?? '',
      department: profile?.department ?? '',
      designation: profile?.designation ?? '',
      speciality: profile?.speciality ?? '',
      unit: profile?.unit ?? '',
      hospitalName: profile?.hospitalName ?? '',
      role: profile?.role ?? 'doctor',
      contactEmail: profile?.contactEmail ?? '',
      contactPhone: profile?.contactPhone ?? '',
      notes: profile?.notes ?? ''
    }))
  );
  let joiningDate = $state(untrack(() => employment?.startDate ?? app.today));
  let employmentType = $state<EmploymentRecord['employmentType']>(
    untrack(() => employment?.employmentType ?? 'permanent')
  );
  let error = $state('');

  const prefixOptions = NAME_PREFIXES.map((prefix) => ({ value: prefix, label: prefix }));
  const roleOptions = USER_ROLES.map((role) => ({
    value: role,
    label: role === 'hod' ? 'Head of department' : titleCase(role)
  }));
  const employmentOptions = [
    { value: 'permanent', label: 'Permanent' },
    { value: 'temporary', label: 'Temporary' },
    { value: 'contract', label: 'Contract' },
    { value: 'visiting', label: 'Visiting' }
  ];

  async function save() {
    error = '';
    const resolvedPrefix = draft.prefix === 'Other' ? customPrefix.trim() : draft.prefix;
    if (draft.prefix === 'Other' && !resolvedPrefix) {
      error = 'Enter the custom prefix.';
      return;
    }
    const payload: ProfileDraft = { ...draft };
    await app.perform(
      (services) =>
        services.saveProfile(payload, {
          resolvedPrefix,
          joiningDate,
          employmentType,
          organisationName: draft.hospitalName.trim()
        }),
      'Profile updated.'
    );
  }

  async function exportLeave() {
    await app.perform(async (services) => {
      const { text, filename } = await services.exportText('leave');
      downloadText(filename, text);
    }, 'Leave history exported.');
  }
</script>

<PageHeader
  title="Account"
  subtitle="Your identifying details and local data. Everything here stays on this device."
>
  <Button variant="secondary" onclick={() => void app.backupNow()}>
    <Download size={14} /> Back up now
  </Button>
</PageHeader>

{#if app.lastError}
  <div class="banner banner-danger" style="margin-bottom:12px">
    <div>
      <strong>{app.lastError.message}</strong>
      {#if app.lastError.reasons.length}
        <ul class="reasons">{#each app.lastError.reasons as reason}<li class="reason reason-error">{reason}</li>{/each}</ul>
      {/if}
    </div>
  </div>
{/if}

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:12px;align-items:start">
  <Card>
    <div class="section-card-head">
      <h2>Profile</h2>
      <span class="tiny muted">Compulsory: prefix, name, employee ID, department, designation</span>
    </div>
    {#if error}<div class="banner banner-danger" style="margin-bottom:8px">{error}</div>{/if}

    <div class="form-grid">
      <Select label="Prefix" bind:value={draft.prefix} options={prefixOptions} required />
      {#if draft.prefix === 'Other'}
        <Field label="Custom prefix" bind:value={customPrefix} required />
      {/if}
      <Field label="Full name" bind:value={draft.name} required />
      <Field label="Employee ID" bind:value={draft.employeeId} required />
      <Field label="Department" bind:value={draft.department} required />
      <Field label="Designation" bind:value={draft.designation} required />
      <Field label="Speciality" bind:value={draft.speciality} />
      <Field label="Unit number" bind:value={draft.unit} />
      <Field label="Medical college / hospital" bind:value={draft.hospitalName} />
      <Select label="Role" bind:value={draft.role} options={roleOptions} />
      <Field label="Joining date" type="date" bind:value={joiningDate} />
      <Select label="Employment type" bind:value={employmentType} options={employmentOptions} />
      <Field label="Email" type="email" bind:value={draft.contactEmail} />
      <Field label="Phone" type="tel" bind:value={draft.contactPhone} />
    </div>
    <Field label="Notes" type="textarea" bind:value={draft.notes} rows={2} />
    <div class="row" style="margin-top:8px">
      <Button onclick={save} disabled={app.busy}>Save profile</Button>
      <span class="tiny muted">Changing the joining date changes proration and RH periods.</span>
    </div>
  </Card>

  <div class="stack">
    <Card>
      <div class="section-card-head"><h2>Employment</h2></div>
      {#if employment}
        <dl class="detail-grid">
          <div><dt>Started</dt><dd>{formatDate(employment.startDate, app.settings?.dateFormat)}</dd></div>
          <div><dt>Type</dt><dd>{employment.employmentType}</dd></div>
          <div><dt>Department</dt><dd>{employment.department}</dd></div>
          <div><dt>Unit</dt><dd>{employment.unit || '—'}</dd></div>
          <div><dt>Primary</dt><dd>{employment.isPrimary ? 'Yes' : 'No'}</dd></div>
          <div><dt>Ended</dt><dd>{employment.endDate ? formatDate(employment.endDate) : 'Current'}</dd></div>
        </dl>
      {:else}
        <p class="tiny muted">No employment record. Save the profile above to create one.</p>
      {/if}
      <p class="tiny muted" style="margin:8px 0 0">
        The employment start date is used for the prorated joining year and for the two
        restricted-holiday periods.
      </p>
    </Card>

    <Card>
      <div class="section-card-head">
        <h2>Local data</h2>
        <Badge tone="success">On this device</Badge>
      </div>
      <dl class="detail-grid">
        <div><dt>Leave records</dt><dd>{counts.leaveRequests}</dd></div>
        <div><dt>Ledger entries</dt><dd>{counts.ledgerEntries}</dd></div>
        <div><dt>Duties</dt><dd>{counts.duties}</dd></div>
        <div><dt>PDOs</dt><dd>{counts.pdos}</dd></div>
        <div><dt>Holidays</dt><dd>{counts.holidays}</dd></div>
        <div><dt>Roster months</dt><dd>{counts.rosterMonths}</dd></div>
        <div><dt>Policy versions</dt><dd>{counts.policyVersions}</dd></div>
        <div><dt>Attendance records</dt><dd>{counts.attendanceRecords}</dd></div>
      </dl>
      <div class="row" style="margin-top:9px">
        <Button size="sm" variant="secondary" onclick={exportLeave}>Export leave history</Button>
        <Button size="sm" variant="subtle" onclick={() => void app.backupNow()}>Download full backup</Button>
      </div>
      <p class="tiny muted" style="margin:8px 0 0">
        Use Settings → Import to restore a backup. DocTrack keeps a version snapshot before any
        import so it can be reversed.
      </p>
    </Card>
  </div>
</div>
