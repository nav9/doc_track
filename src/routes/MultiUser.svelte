<script lang="ts">
  import {
    CalendarDays,
    ClipboardPaste,
    Download,
    Plus,
    Trash2,
    Upload,
    Users
  } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import Dialog from '../lib/components/ui/Dialog.svelte';
  import DateRangePicker from '../lib/components/ui/DateRangePicker.svelte';
  import { formatDate, endOfMonth, startOfMonth } from '../lib/domain/common/dates';
  import { rangeText, statusTone } from '../lib/app/ui';
  import { downloadText, pickTextFile, writeClipboard } from '../lib/infrastructure/files/files';
  import {
    parseWhatsAppShares,
    type ParsedDoctorShare
  } from '../lib/domain/multiuser/parse';
  import {
    isSharedLeaveActive,
    sharedLeaveCoversDate,
    type SharedLeave
  } from '../lib/domain/multiuser/types';
  import type { LeaveStatus } from '../lib/domain/leave/types';
  import type { RosterDoctor } from '../lib/domain/roster/types';
  import type { ImportPreview } from '../lib/application/dto/version';
  import { messageOf } from '../lib/application/services/errors';

  const WHATSAPP_TEMPLATE = `Dr. Full Name
Employee ID: MC-101
Department: Orthopaedics
Designation: Senior Resident
Speciality: Joint Replacement
Unit: Unit II
Leave: 10 Nov 2026 to 12 Nov 2026
Leave type: CL
Leave status: Approved
Reason: Family function`;

  let search = $state('');
  let specialityFilter = $state('');
  let rangeStart = $state(startOfMonth(app.today));
  let rangeEnd = $state(endOfMonth(app.today));
  let availabilityDate = $state(app.today);
  let doctorEditing = $state<string | null>(null);
  let manualOpen = $state(false);
  let pasteOpen = $state(false);
  let pasteText = $state('');
  let parsed = $state<ParsedDoctorShare[]>([]);
  let parseError = $state('');
  let importResult = $state<{
    added: number;
    updated: number;
    skipped: number;
    leaves: number;
    changes: string[];
  } | null>(null);
  let importText = $state('');
  let preview = $state<ImportPreview | null>(null);
  let importBusy = $state(false);

  let doctorDraft = $state({
    name: '',
    employeeId: '',
    department: '',
    designation: '',
    speciality: '',
    unit: '',
    contactPhone: ''
  });
  let leaveDraft = $state({
    doctorId: '',
    startDate: app.today,
    endDate: app.today,
    category: 'CL',
    status: 'planned' as LeaveStatus,
    reason: '',
    notes: ''
  });

  const doctors = $derived(
    [...app.snapshot.doctors].sort(
      (a, b) =>
        a.department.localeCompare(b.department) || a.name.localeCompare(b.name)
    )
  );
  const filteredDoctors = $derived(
    doctors.filter((doctor) => {
      const query = search.trim().toLowerCase();
      if (!query) return true;
      return [doctor.name, doctor.employeeId, doctor.department, doctor.speciality ?? '']
        .join(' ')
        .toLowerCase()
        .includes(query);
    })
  );
  const rangeLeaves = $derived(
    app.snapshot.sharedLeaves
      .filter(
        (leave) =>
          leave.startDate <= (rangeEnd || '9999-12-31') &&
          leave.endDate >= (rangeStart || '0000-01-01')
      )
      .sort(
        (a, b) =>
          a.startDate.localeCompare(b.startDate) ||
          a.doctorName.localeCompare(b.doctorName)
      )
  );
  const specialityOptions = $derived(
    [...new Set(doctors.map((doctor) => doctor.speciality?.trim() ?? '').filter(Boolean))].sort(
      (a, b) => a.localeCompare(b)
    )
  );
  const availabilityRows = $derived(
    doctors
      .filter(
        (doctor) =>
          !specialityFilter ||
          (doctor.speciality?.trim().toLowerCase() ?? '') === specialityFilter.toLowerCase()
      )
      .map((doctor) => {
      const onDate = app.snapshot.sharedLeaves.filter(
        (leave) =>
          leave.doctorId === doctor.id &&
          isSharedLeaveActive(leave) &&
          sharedLeaveCoversDate(leave, availabilityDate)
      );
      const inRange = app.snapshot.sharedLeaves.filter(
        (leave) =>
          leave.doctorId === doctor.id &&
          isSharedLeaveActive(leave) &&
          leave.startDate <= rangeEnd &&
          leave.endDate >= rangeStart
      );
        return { doctor, onDate, inRange, available: onDate.length === 0 };
      })
  );
  const availableRows = $derived(
    availabilityRows
      .filter((row) => row.available)
      .sort(
        (a, b) =>
          a.inRange.length - b.inRange.length ||
          a.doctor.name.localeCompare(b.doctor.name)
      )
  );
  const unavailableCount = $derived(
    availabilityRows.filter((row) => !row.available).length
  );
  const activeRangeLeaves = $derived(rangeLeaves.filter(isSharedLeaveActive));
  const selectedLeaveDoctor = $derived(
    doctors.find((doctor) => doctor.id === leaveDraft.doctorId) ?? null
  );

  function doctorMatch(employeeId: string, name: string): RosterDoctor | undefined {
    const employee = employeeId.trim().toLowerCase();
    const normalizedName = name.trim().toLowerCase();
    return app.snapshot.doctors.find(
      (doctor) =>
        (employee && doctor.employeeId.trim().toLowerCase() === employee) ||
        (normalizedName && doctor.name.trim().toLowerCase() === normalizedName)
    );
  }

  function changeLabels(existing: RosterDoctor, candidate: {
    name: string;
    employeeId: string;
    department: string;
    designation: string;
    speciality: string;
    unit: string;
    contactPhone: string;
  }): string[] {
    const fields: [string, string, string][] = [
      ['Name', existing.name, candidate.name],
      ['Employee ID', existing.employeeId, candidate.employeeId],
      ['Department', existing.department, candidate.department],
      ['Designation', existing.designation, candidate.designation],
      ['Speciality', existing.speciality ?? '', candidate.speciality],
      ['Unit', existing.unit, candidate.unit],
      ['Phone', existing.contactPhone ?? '', candidate.contactPhone]
    ];
    return fields
      .filter(([, before, after]) => before.trim() !== after.trim())
      .map(([label, before, after]) => `${label}: “${before || 'blank'}” → “${after || 'blank'}”`);
  }

  function changesFor(record: ParsedDoctorShare): string[] {
    const existing = doctorMatch(record.employeeId, record.name);
    return existing ? changeLabels(existing, record) : [];
  }

  function editDoctor(doctor: RosterDoctor) {
    doctorEditing = doctor.id;
    doctorDraft = {
      name: doctor.name,
      employeeId: doctor.employeeId,
      department: doctor.department,
      designation: doctor.designation,
      speciality: doctor.speciality ?? '',
      unit: doctor.unit,
      contactPhone: doctor.contactPhone ?? ''
    };
    manualOpen = true;
  }

  function resetDoctor() {
    doctorEditing = null;
    doctorDraft = {
      name: '',
      employeeId: '',
      department: '',
      designation: '',
      speciality: '',
      unit: '',
      contactPhone: ''
    };
  }

  async function saveDoctor() {
    if (!doctorDraft.name.trim() || !doctorDraft.employeeId.trim()) {
      app.notify('error', 'Enter the doctor’s name and employee ID.');
      return;
    }
    const existing = doctorEditing
      ? app.snapshot.doctors.find((doctor) => doctor.id === doctorEditing)
      : doctorMatch(doctorDraft.employeeId, doctorDraft.name);
    const changes = existing ? changeLabels(existing, doctorDraft) : [];
    const saved = await app.perform(
      (services) =>
        services.saveRosterDoctor({
          id: existing?.id,
          name: doctorDraft.name,
          employeeId: doctorDraft.employeeId,
          department: doctorDraft.department,
          designation: doctorDraft.designation,
          speciality: doctorDraft.speciality,
          unit: doctorDraft.unit,
          contactPhone: doctorDraft.contactPhone,
          profileId: existing?.profileId ?? null,
          notes: existing ? 'Updated from Multi User.' : 'Added from Multi User.'
        }),
      existing
        ? changes.length
          ? `Existing doctor updated: ${changes.join('; ')}`
          : 'Existing doctor matched; no duplicate was created.'
        : 'Doctor added to the shared list.'
    );
    if (saved) {
      resetDoctor();
      manualOpen = false;
    }
  }

  async function addLeave() {
    if (!leaveDraft.doctorId) {
      app.notify('error', 'Choose the doctor whose leave you are adding.');
      return;
    }
    if (leaveDraft.endDate < leaveDraft.startDate) {
      app.notify('error', 'The leave end date is before the start date.');
      return;
    }
    const saved = await app.perform(
      (services) =>
        services.saveSharedLeave({
          doctorId: leaveDraft.doctorId,
          startDate: leaveDraft.startDate,
          endDate: leaveDraft.endDate,
          category: leaveDraft.category,
          status: leaveDraft.status,
          reason: leaveDraft.reason,
          notes: leaveDraft.notes,
          source: 'manual'
        }),
      'Temporary leave added. It does not change any doctor’s official balance.'
    );
    if (saved) {
      leaveDraft.endDate = leaveDraft.startDate;
      leaveDraft.reason = '';
      leaveDraft.notes = '';
    }
  }

  async function updateLeaveStatus(leave: SharedLeave, status: LeaveStatus) {
    await app.perform(
      (services) =>
        services.saveSharedLeave({
          id: leave.id,
          doctorId: leave.doctorId,
          startDate: leave.startDate,
          endDate: leave.endDate,
          category: leave.category,
          status,
          reason: leave.reason,
          notes: leave.notes,
          source: leave.source
        }),
      'Temporary leave status changed.'
    );
  }

  async function deleteLeave(leave: SharedLeave) {
    if (!window.confirm(`Remove the temporary leave for ${leave.doctorName}?`)) return;
    await app.perform(
      (services) => services.deleteSharedLeave(leave.id),
      'Temporary leave removed.'
    );
  }

  function parsePaste() {
    parseError = '';
    importResult = null;
    try {
      parsed = parseWhatsAppShares(pasteText, app.today);
      if (!parsed.length) parseError = 'No doctor details were recognised in the pasted text.';
    } catch (error) {
      parsed = [];
      parseError = messageOf(error);
    }
  }

  async function applyPaste() {
    if (!parsed.length) return;
    let outcome: {
      added: number;
      updated: number;
      skipped: number;
      leaves: number;
      changes: string[];
    } | null = null;
    const result = await app.perform(async (services) => {
      let added = 0;
      let updated = 0;
      let skipped = 0;
      let leaves = 0;
      const changes: string[] = [];
      for (const record of parsed) {
        if (!record.name.trim() || !record.employeeId.trim()) {
          skipped += 1;
          continue;
        }
        const snapshot = await services.snapshot();
        const existing = snapshot.doctors.find(
          (doctor) =>
            doctor.employeeId.trim().toLowerCase() === record.employeeId.trim().toLowerCase() ||
            doctor.name.trim().toLowerCase() === record.name.trim().toLowerCase()
        );
        const recordChanges = existing ? changeLabels(existing, record) : [];
        if (recordChanges.length) changes.push(`${record.name}: ${recordChanges.join('; ')}`);
        const doctor = await services.saveRosterDoctor({
          id: existing?.id,
          name: record.name,
          employeeId: record.employeeId,
          department: record.department,
          designation: record.designation,
          speciality: record.speciality,
          unit: record.unit,
          contactPhone: record.contactPhone,
          profileId: existing?.profileId ?? null,
          notes: existing ? 'Updated from WhatsApp share.' : 'Added from WhatsApp share.'
        });
        if (existing) updated += 1;
        else added += 1;
        if (record.leave) {
          await services.saveSharedLeave({
            doctorId: doctor.id,
            startDate: record.leave.startDate,
            endDate: record.leave.endDate,
            category: record.leave.category,
            status: record.leave.status,
            reason: record.leave.reason,
            notes: 'Imported from a WhatsApp share.',
            source: 'whatsapp'
          });
          leaves += 1;
        }
      }
      outcome = { added, updated, skipped, leaves, changes };
    }, 'WhatsApp doctor data checked and saved.');
    if (result && outcome) {
      importResult = outcome;
      pasteOpen = false;
      parsed = [];
      pasteText = '';
    }
  }

  async function copyTemplate() {
    try {
      await writeClipboard(WHATSAPP_TEMPLATE);
      app.notify('success', 'WhatsApp template copied.');
    } catch (error) {
      app.notify('error', messageOf(error));
    }
  }

  async function exportShared() {
    await app.perform(async (services) => {
      const { text, filename } = await services.exportText('multiuser');
      downloadText(filename, text);
    }, 'Shared doctor and leave data exported.');
  }

  async function loadImportFile() {
    const file = await pickTextFile();
    if (!file) return;
    importText = file.text;
    preview = null;
  }

  async function previewImport() {
    if (!app.services) return;
    importBusy = true;
    app.lastError = null;
    preview = null;
    try {
      preview = await app.services.previewImport(importText);
    } catch (error) {
      app.notify('error', messageOf(error));
    } finally {
      importBusy = false;
    }
  }

  async function applyImport() {
    if (!preview) return;
    const current = preview;
    const result = await app.perform(
      (services) => services.applyImport(current),
      'Import complete. A version snapshot was taken first.'
    );
    if (result) {
      preview = null;
      importText = '';
    }
  }
</script>

<PageHeader
  title="Multi User"
  subtitle="Known doctors, shared leave, availability and temporary planning in one place."
>
  <Button variant="secondary" onclick={() => (pasteOpen = true)}>
    <ClipboardPaste size={14} /> Paste from clipboard
  </Button>
  <Button onclick={exportShared}><Download size={14} /> Export shared data</Button>
</PageHeader>

{#if app.lastError}
  <div class="banner banner-danger" style="margin-bottom:12px">
    <div>
      <strong>{app.lastError.message}</strong>
      {#if app.lastError.reasons.length}
        <ul class="reasons">
          {#each app.lastError.reasons as reason}<li class="reason reason-error">{reason}</li>{/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

{#if importResult}
  <div class="banner banner-success" style="margin-bottom:12px">
    <div>
      <strong>
        {importResult.added} new doctor(s), {importResult.updated} existing doctor(s) checked,
        {importResult.leaves} leave record(s) saved.
      </strong>
      {#if importResult.skipped}<div>{importResult.skipped} row(s) skipped because the name or employee ID was missing.</div>{/if}
      {#if importResult.changes.length}
        <ul class="reasons">
          {#each importResult.changes as change}<li class="reason reason-info">{change}</li>{/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<div class="two-col">
  <div class="stack">
    <Card>
      <div class="section-card-head">
        <div>
          <h2>Known doctors</h2>
          <p class="tiny muted" style="margin:2px 0 0">
            One central record per employee ID. Roster and Multi User use the same list.
          </p>
        </div>
        <Badge tone="info">{doctors.length} doctors</Badge>
      </div>
      <div class="row" style="margin-bottom:9px">
        <Field label="Search doctors" bind:value={search} placeholder="Name, employee ID, department…" />
        <Button
          size="sm"
          variant="secondary"
          onclick={() => { resetDoctor(); manualOpen = true; }}
        ><Plus size={13} /> Add doctor</Button>
      </div>

      {#if filteredDoctors.length === 0}
        <div class="empty">
          <Users size={20} />
          <strong>No doctors found</strong>
          <span class="tiny muted">Add a doctor manually or paste details copied from WhatsApp.</span>
        </div>
      {:else}
        <div class="stack-sm">
          {#each filteredDoctors as doctor (doctor.id)}
            {@const leaves = app.snapshot.sharedLeaves.filter(
              (leave) => leave.doctorId === doctor.id && isSharedLeaveActive(leave)
            )}
            <div class="list-row">
              <div class="list-main">
                <div class="list-title">{doctor.name}</div>
                <div class="tiny muted">
                  {doctor.employeeId || 'No employee ID'} · {doctor.department || 'No department'}
                  {#if doctor.designation} · {doctor.designation}{/if}
                  {#if doctor.speciality} · {doctor.speciality}{/if}
                </div>
              </div>
              {#if leaves.length}<Badge tone="warning">{leaves.length} leave</Badge>{/if}
              <Button size="sm" variant="ghost" onclick={() => editDoctor(doctor)}>Edit</Button>
              <Button
                size="sm"
                variant="subtle"
                onclick={() => {
                  leaveDraft.doctorId = doctor.id;
                  leaveDraft.startDate = availabilityDate;
                  leaveDraft.endDate = availabilityDate;
                }}
              >Add leave</Button>
            </div>
          {/each}
        </div>
      {/if}
    </Card>

    <Card>
      <div class="section-card-head">
        <div>
          <h2>Shared leave for this period</h2>
          <p class="tiny muted" style="margin:2px 0 0">Temporary adjustments only — no ledger or approval changes.</p>
        </div>
        <Badge tone={activeRangeLeaves.length ? 'warning' : 'success'}>
          {activeRangeLeaves.length} active
        </Badge>
      </div>
      <div class="form-grid">
        <DateRangePicker label="Leave period" bind:start={rangeStart} bind:end={rangeEnd} />
      </div>
      {#if rangeLeaves.length === 0}
        <p class="tiny muted">No shared leave overlaps this period.</p>
      {:else}
        <div class="table-wrap">
          <table class="table-base">
            <thead>
              <tr><th>Doctor</th><th>Dates</th><th>Type</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {#each rangeLeaves as leave (leave.id)}
                <tr>
                  <td>
                    <strong>{leave.doctorName}</strong>
                    <div class="tiny muted">{leave.employeeId}</div>
                  </td>
                  <td>{rangeText(leave.startDate, leave.endDate)}</td>
                  <td>{leave.category}</td>
                  <td>
                    <select
                      class="input-base"
                      value={leave.status}
                      onchange={(event) => void updateLeaveStatus(leave, event.currentTarget.value as LeaveStatus)}
                    >
                      <option value="planned">Planned</option>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </td>
                  <td>
                    <button type="button" class="icon-btn" aria-label={`Remove leave for ${leave.doctorName}`} onclick={() => void deleteLeave(leave)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Card>
  </div>

  <div class="stack">
    <Card>
      <div class="section-card-head">
        <div>
          <h2>Availability check</h2>
          <p class="tiny muted" style="margin:2px 0 0">Pick a duty date, then add a temporary leave if someone becomes unavailable.</p>
        </div>
        <Badge tone={unavailableCount ? 'warning' : 'success'}>
          {unavailableCount ? `${unavailableCount} unavailable` : 'All available'}
        </Badge>
      </div>
      <div class="form-grid">
        <Field label="Duty date" type="date" bind:value={availabilityDate} />
        <label class="field">
          <span class="field-label">Speciality</span>
          <select class="input-base" bind:value={specialityFilter}>
            <option value="">All specialities</option>
            {#each specialityOptions as option (option)}
              <option value={option}>{option}</option>
            {/each}
          </select>
        </label>
      </div>
      <div class="banner banner-info" style="margin:8px 0">
        <div>
          <strong>Suggested for {formatDate(availabilityDate)}</strong>
          {#if availableRows.length}
            <div>
              {availableRows.slice(0, 3).map((row) => row.doctor.name).join(', ')}
              <span class="tiny muted">— least shared leave in this period first.</span>
            </div>
          {:else}
            <div>Everyone known is on shared leave on this date. Check the specialty or import more doctors.</div>
          {/if}
        </div>
      </div>
      <div class="stack-sm">
        {#each availabilityRows as row (row.doctor.id)}
          <div class="list-row">
            <div class="list-main">
              <div class="list-title">{row.doctor.name}</div>
              <div class="tiny muted">{row.doctor.department || 'No department'} · {row.inRange.length} leave day(s) in period</div>
            </div>
            {#if row.available}
              <Badge tone="success">Available</Badge>
            {:else}
              <Badge tone="warning">On leave</Badge>
            {/if}
          </div>
          {#if row.onDate.length}
            <p class="tiny muted" style="margin:-2px 0 2px 4px">
              {row.onDate.map((leave) => `${leave.category} · ${leave.status}`).join(', ')}
            </p>
          {/if}
        {/each}
      </div>
    </Card>

    <Card>
      <div class="section-card-head">
        <h2>Add a temporary leave</h2>
        <CalendarDays size={16} />
      </div>
      <div class="form-grid">
        <label class="field">
          <span class="field-label">Doctor</span>
          <select class="input-base" bind:value={leaveDraft.doctorId}>
            <option value="">— Select doctor —</option>
            {#each doctors as doctor (doctor.id)}
              <option value={doctor.id}>{doctor.name} · {doctor.employeeId}</option>
            {/each}
          </select>
        </label>
        <DateRangePicker
          label="Leave dates"
          bind:start={leaveDraft.startDate}
          bind:end={leaveDraft.endDate}
          hint="The same day twice records a one-day leave."
        />
        <Field label="Leave type" bind:value={leaveDraft.category} placeholder="CL" />
        <label class="field">
          <span class="field-label">Status</span>
          <select class="input-base" bind:value={leaveDraft.status}>
            <option value="planned">Planned</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <Field label="Reason" bind:value={leaveDraft.reason} placeholder="Optional" />
      </div>
      {#if selectedLeaveDoctor}
        <p class="tiny muted" style="margin:0 0 6px">
          {selectedLeaveDoctor.name} · {selectedLeaveDoctor.employeeId} · {selectedLeaveDoctor.department}
        </p>
      {/if}
      <div class="row">
        <Button size="sm" onclick={addLeave}>Add temporary leave</Button>
        <span class="tiny muted">This does not approve leave or affect any leave balance.</span>
      </div>
    </Card>
  </div>
</div>

<Card>
  <div class="section-card-head">
    <div>
      <h2>Import and export</h2>
      <p class="tiny muted" style="margin:2px 0 0">Move the known-doctor list and shared leave between devices or colleagues.</p>
    </div>
    <Badge tone="neutral">Local only</Badge>
  </div>
  <div class="form-grid">
    <div class="stack-sm">
      <Button variant="secondary" onclick={exportShared}><Download size={14} /> Download Multi User export</Button>
      <p class="tiny muted" style="margin:0">Contains shared doctors and temporary leave, not the signed-in doctor’s private ledger.</p>
    </div>
    <div class="stack-sm">
      <Field label="Paste a DocTrack export" type="textarea" bind:value={importText} rows={4} placeholder="-----BEGIN DOCTRACK DATA-----…" />
      <div class="row">
        <Button size="sm" variant="secondary" onclick={loadImportFile}><Upload size={13} /> Choose file</Button>
        <Button size="sm" onclick={previewImport} disabled={importBusy || !importText.trim()}>
          {importBusy ? 'Reading…' : 'Preview import'}
        </Button>
      </div>
    </div>
  </div>
  {#if preview}
    <div class="divider"></div>
    <div class="between">
      <strong>{preview.label}</strong>
      <Badge tone="info">{preview.kind}</Badge>
    </div>
    <div class="row" style="margin-top:6px">
      <span class="tiny muted">{preview.counts.sharedLeaves} shared leave record(s)</span>
      {#if preview.invalidCount}<span class="tiny muted">{preview.invalidCount} unreadable record(s)</span>{/if}
    </div>
    <div class="row" style="margin-top:8px">
      <Button size="sm" onclick={applyImport} disabled={app.busy}>Apply import</Button>
      <Button size="sm" variant="ghost" onclick={() => (preview = null)}>Cancel</Button>
    </div>
  {/if}
</Card>

<Dialog
  open={manualOpen}
  title={doctorEditing ? 'Edit known doctor' : 'Add a known doctor'}
  subtitle="Employee ID is the key used to avoid duplicate records."
  onclose={() => (manualOpen = false)}
>
  <div class="form-grid">
    <Field label="Doctor's name" bind:value={doctorDraft.name} required />
    <Field label="Employee ID" bind:value={doctorDraft.employeeId} required />
    <Field label="Department" bind:value={doctorDraft.department} />
    <Field label="Designation" bind:value={doctorDraft.designation} />
    <Field label="Speciality" bind:value={doctorDraft.speciality} />
    <Field label="Unit" bind:value={doctorDraft.unit} />
    <Field label="Phone" type="tel" bind:value={doctorDraft.contactPhone} />
  </div>
  <div class="row" style="margin-top:10px">
    <Button onclick={() => void saveDoctor()} disabled={app.busy}>Save doctor</Button>
    <Button variant="ghost" onclick={resetDoctor}>Clear</Button>
  </div>
</Dialog>

<Dialog
  open={pasteOpen}
  title="WhatsApp doctor import"
  subtitle="Paste doctor details and optional leave dates. Nothing leaves this device."
  onclose={() => (pasteOpen = false)}
>
  <div class="row" style="margin-bottom:8px">
    <Button size="sm" variant="secondary" onclick={copyTemplate}><ClipboardPaste size={13} /> Copy template</Button>
  </div>
  <Field label="Pasted message" type="textarea" bind:value={pasteText} rows={9} placeholder={WHATSAPP_TEMPLATE} />
  <div class="row" style="margin-top:8px">
    <Button size="sm" onclick={parsePaste} disabled={!pasteText.trim()}>Check details</Button>
    <Button size="sm" variant="ghost" onclick={() => { parsed = []; pasteText = ''; parseError = ''; }}>Clear</Button>
  </div>
  {#if parseError}<div class="banner banner-warning" style="margin-top:8px">{parseError}</div>{/if}
  {#if parsed.length}
    <div class="divider"></div>
    <div class="stack-sm">
      {#each parsed as record, index (index)}
        {@const existing = doctorMatch(record.employeeId, record.name)}
        {@const changes = changesFor(record)}
        <div class="list-row" style="align-items:flex-start">
          <div class="list-main">
            <div class="list-title">{record.name || 'Unnamed doctor'}</div>
            <div class="tiny muted">{record.employeeId || 'No employee ID'} · {record.department || 'No department'} {#if record.leave}· leave {rangeText(record.leave.startDate, record.leave.endDate)}{/if}</div>
            {#if record.warnings.length}
              <div class="tiny warning-text">{record.warnings.join(' ')}</div>
            {/if}
            {#if changes.length}
              <div class="tiny" style="color:var(--warning)">Updated: {changes.join('; ')}</div>
            {/if}
          </div>
          <Badge tone={existing ? 'warning' : 'success'}>{existing ? 'Existing' : 'New'}</Badge>
        </div>
      {/each}
    </div>
    <div class="row" style="margin-top:8px">
      <Button onclick={() => void applyPaste()} disabled={app.busy}>Save checked doctors</Button>
      <Button variant="ghost" onclick={() => (pasteOpen = false)}>Cancel</Button>
    </div>
  {/if}
</Dialog>