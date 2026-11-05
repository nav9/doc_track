<script lang="ts">
  import { Download, Trash2 } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Select from '../lib/components/ui/Select.svelte';
  import Toggle from '../lib/components/ui/Toggle.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import Dialog from '../lib/components/ui/Dialog.svelte';
  import { prepareRosterPdfData, rosterPreviewLines } from '../lib/infrastructure/pdf/rosterData';
  import { downloadBlob } from '../lib/infrastructure/files/files';
  import { DATE_FORMATS, daysInMonth, formatDate, formatMonthYear } from '../lib/domain/common/dates';
  import type { DateFormat } from '../lib/domain/common/dates';
  import {
    DEFAULT_ROSTER_PDF_OPTIONS,
    ROSTER_DUTY_TYPES
  } from '../lib/domain/roster/types';
  import type {
    DutyRoster,
    RosterDutyType,
    RosterEntry,
    RosterPdfOptions
  } from '../lib/domain/roster/types';
  import { newId } from '../lib/domain/common/ids';

  let year = $state(Number(app.today.slice(0, 4)));
  let month = $state(Number(app.today.slice(5, 7)));
  let draft = $state<DutyRoster | null>(null);
  let loadedKey = $state('');
  let syncDuties = $state(true);
  let pdfOpen = $state(false);
  let pdfOptions = $state<RosterPdfOptions>({ ...DEFAULT_ROSTER_PDF_OPTIONS });

  const profile = $derived(app.profile);
  const employment = $derived(app.employment);
  const pad2 = (value: number) => String(value).padStart(2, '0');
  const monthPrefix = $derived(`${year}-${pad2(month)}`);
  const lastDay = $derived(daysInMonth(year, month));
  const defaultDoctorName = $derived(
    profile ? `${profile.prefix} ${profile.name}`.trim() : ''
  );
  const nightTimes = $derived.by(() => {
    const shift =
      app.activePolicy?.shifts.find(
        (item) => item.kind === 'night' && item.durationHours === 24
      ) ?? app.activePolicy?.shifts[0];
    return { start: shift?.startTime ?? '09:00', end: shift?.endTime ?? '09:00' };
  });
  const doctorNames = $derived(
    [...new Set([
      defaultDoctorName,
      ...app.snapshot.doctors.map((doctor) => doctor.name)
    ].filter(Boolean))].sort()
  );

  function buildDraft(): DutyRoster {
    const existing = app.snapshot.rosters.find(
      (roster) => roster.year === year && roster.month === month
    );
    if (existing) return $state.snapshot(existing);
    return {
      id: '',
      profileId: profile?.id ?? '',
      year,
      month,
      title: 'Night Duty Roster',
      department: employment?.department ?? profile?.department ?? '',
      unit: employment?.unit ?? '',
      hospitalName: profile?.hospitalName ?? '',
      entries: [],
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  $effect(() => {
    const key = `${year}-${month}`;
    const rosters = app.snapshot.rosters;
    if (key !== loadedKey) {
      loadedKey = key;
      draft = buildDraft();
    }
    void rosters;
  });

  const sortedEntries = $derived(
    draft ? [...draft.entries].sort((a, b) => a.date.localeCompare(b.date)) : []
  );
  const uncovered = $derived.by(() => {
    if (!draft) return 0;
    const covered = new Set(draft.entries.map((entry) => entry.date));
    let count = 0;
    for (let day = 1; day <= lastDay; day += 1) {
      if (!covered.has(`${monthPrefix}-${pad2(day)}`)) count += 1;
    }
    return count;
  });

  function blankEntry(date: string): RosterEntry {
    return {
      id: newId('rentry'),
      date,
      doctorId: null,
      doctorName: defaultDoctorName,
      employeeId: profile?.employeeId ?? '',
      department: employment?.department ?? profile?.department ?? '',
      unit: employment?.unit ?? '',
      startTime: nightTimes.start,
      endTime: nightTimes.end,
      dutyType: 'night',
      remarks: '',
      swapNote: '',
      dutyId: null
    };
  }

  function addEntry() {
    if (!draft) return;
    const used = new Set(draft.entries.map((entry) => entry.date));
    let next = `${monthPrefix}-01`;
    for (let day = 1; day <= lastDay; day += 1) {
      const candidate = `${monthPrefix}-${pad2(day)}`;
      if (!used.has(candidate)) {
        next = candidate;
        break;
      }
    }
    draft.entries = [...draft.entries, blankEntry(next)];
  }

  function fillMonth() {
    if (!draft) return;
    const used = new Set(draft.entries.map((entry) => entry.date));
    const added: RosterEntry[] = [];
    for (let day = 1; day <= lastDay; day += 1) {
      const date = `${monthPrefix}-${pad2(day)}`;
      if (!used.has(date)) added.push(blankEntry(date));
    }
    draft.entries = [...draft.entries, ...added];
    app.notify('info', `${added.length} day${added.length === 1 ? '' : 's'} added to the draft.`);
  }

  function removeEntry(id: string) {
    if (!draft) return;
    draft.entries = draft.entries.filter((entry) => entry.id !== id);
  }

  function applyDoctor(entry: RosterEntry) {
    const match = app.snapshot.doctors.find(
      (doctor) => doctor.name.toLowerCase() === entry.doctorName.trim().toLowerCase()
    );
    if (match) {
      entry.doctorId = match.id;
      entry.employeeId = match.employeeId || entry.employeeId;
      entry.department = match.department || entry.department;
      entry.unit = match.unit || entry.unit;
    } else {
      entry.doctorId = null;
    }
  }

  function copyPreviousMonth() {
    if (!draft || !app.services) return;
    const previousMonth = month === 1 ? 12 : month - 1;
    const previousYear = month === 1 ? year - 1 : year;
    const previous = app.snapshot.rosters.find(
      (roster) => roster.year === previousYear && roster.month === previousMonth
    );
    if (!previous) {
      app.notify('info', 'There is no saved roster for the previous month.');
      return;
    }
    draft = app.services.copyPreviousMonth(previous, year, month);
    app.notify('info', 'Previous month copied into this draft. Check dates and swaps before saving.');
  }

  async function saveRoster() {
    if (!draft) return;
    const current = draft;
    const saved = await app.perform(async (services) => {
      for (const name of [...new Set(current.entries.map((entry) => entry.doctorName.trim()).filter(Boolean))]) {
        const existing = app.snapshot.doctors.find(
          (doctor) => doctor.name.toLowerCase() === name.toLowerCase()
        );
        if (!existing) {
          await services.saveRosterDoctor({
            name,
            employeeId: '',
            department: current.department,
            unit: current.unit,
            designation: '',
            profileId: null,
            notes: 'Added while saving a roster.'
          });
        }
      }
      return services.saveRoster(current, { syncDuties });
    }, 'Roster saved.');
    if (saved) draft = $state.snapshot(saved);
  }

  async function deleteRoster() {
    if (!draft?.id) {
      draft = buildDraft();
      app.notify('info', 'Unsaved draft cleared.');
      return;
    }
    if (!window.confirm('Delete this saved roster? Linked duties are cancelled, not deleted.')) return;
    const id = draft.id;
    const result = await app.perform((services) => services.deleteRoster(id), 'Roster deleted.');
    if (result === null && !app.lastError) draft = buildDraft();
  }

  const pdfData = $derived(
    draft ? prepareRosterPdfData(draft, pdfOptions, formatDate(app.today)) : null
  );
  const previewRows = $derived(pdfData ? rosterPreviewLines(pdfData).slice(0, 8) : []);

  async function downloadPdf() {
    if (!pdfData || !draft) return;
    // jsPDF is large; load it only when the doctor asks for the PDF so the
    // initial offline bundle stays small. The chunk is still precached.
    const { generateRosterPdf } = await import('../lib/infrastructure/pdf/rosterPdf');
    const blob = generateRosterPdf(pdfData, `${draft.month}/${draft.year}`);
    downloadBlob(
      `DocTrack_Roster_${draft.year}_${pad2(draft.month)}.pdf`,
      blob
    );
    pdfOpen = false;
    app.notify('success', 'A4 roster PDF generated on this device.');
  }
</script>

<PageHeader
  title="Duty roster"
  subtitle="Month-wise roster with optional duty sync and a vector A4 PDF."
>
  <Badge tone={uncovered > 0 ? 'warning' : 'success'}>
    {uncovered > 0 ? `${uncovered} day${uncovered === 1 ? '' : 's'} uncovered` : 'Every day covered'}
  </Badge>
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

<div class="stack">
  <Card>
    <div class="section-card-head">
      <div class="row">
        <h2>Roster month</h2>
        <Badge tone={draft?.id ? 'success' : 'neutral'}>{draft?.id ? 'Saved' : 'Draft'}</Badge>
      </div>
      <div class="row">
        <Button size="sm" variant="secondary" onclick={copyPreviousMonth}>Copy previous month</Button>
        <Button size="sm" variant="secondary" onclick={fillMonth}>Fill all days</Button>
        <Button size="sm" variant="subtle" onclick={() => (pdfOpen = true)} disabled={!draft || draft.entries.length === 0}>
          <Download size={13} /> PDF preview
        </Button>
      </div>
    </div>

    {#if draft}
      <div class="form-grid">
        <Field label="Month" type="date" value={`${year}-${pad2(month)}-01`} oninput={(event) => { const value = event.currentTarget.value; if (value.length >= 7) { year = Number(value.slice(0, 4)); month = Number(value.slice(5, 7)); } }} hint="Pick any date in the required month." />
        <Field label="Roster title" bind:value={draft.title} />
        <Field label="Department" bind:value={draft.department} />
        <Field label="Unit" bind:value={draft.unit} />
        <Field label="Hospital / college" bind:value={draft.hospitalName} />
      </div>
      <Field label="Roster notes (printed below the table)" type="textarea" bind:value={draft.notes} rows={2} />
      <Toggle bind:checked={syncDuties} label="Create or update my own duty records from this roster" hint="The linked duties feed the planner, PDO and CCL calculations. Duties removed from the roster are cancelled, not deleted." />
      <div class="row" style="margin-top:8px">
        <Button onclick={saveRoster} disabled={app.busy}>Save roster</Button>
        <Button variant="secondary" onclick={addEntry}>Add a day</Button>
        <Button variant="ghost" onclick={deleteRoster}><Trash2 size={13} /> Delete this roster</Button>
        <span class="tiny muted">{draft.entries.length} entries · {uncovered} uncovered</span>
      </div>
    {:else}
      <p class="tiny muted">Choose a month to start a roster.</p>
    {/if}
  </Card>

  {#if draft}
    <Card>
      <div class="section-card-head">
        <h2>Day-wise roster</h2>
        <span class="tiny muted">{formatMonthYear(year, month)}</span>
      </div>
      <datalist id="roster-doctor-names">
        {#each doctorNames as name (name)}<option value={name}></option>{/each}
      </datalist>

      {#if draft.entries.length === 0}
        <div class="empty">
          <strong>No days entered</strong>
          <span class="tiny muted">Add a day or fill the whole month, then assign the doctor on duty.</span>
          <div class="row"><Button size="sm" onclick={fillMonth}>Fill all days</Button></div>
        </div>
      {:else}
        <div class="roster-row roster-head" style="border-bottom:1px solid var(--border);padding-bottom:4px">
          <span class="tiny muted" style="font-weight:800">Date</span>
          <span class="tiny muted" style="font-weight:800">Doctor</span>
          <span class="tiny muted" style="font-weight:800">Duty</span>
          <span class="tiny muted" style="font-weight:800">Start</span>
          <span class="tiny muted" style="font-weight:800">End</span>
          <span class="tiny muted" style="font-weight:800">Remarks</span>
          <span></span>
        </div>
        {#each sortedEntries as entry (entry.id)}
          <div class="roster-row">
            <label class="roster-date">
              <span class="roster-label">Date</span>
              <input class="input-base" type="date" bind:value={entry.date} min={`${monthPrefix}-01`} max={`${monthPrefix}-${pad2(lastDay)}`} />
            </label>
            <label>
              <span class="roster-label">Doctor</span>
              <input class="input-base" list="roster-doctor-names" bind:value={entry.doctorName} onchange={() => applyDoctor(entry)} />
            </label>
            <label>
              <span class="roster-label">Duty</span>
              <select class="input-base" bind:value={entry.dutyType}>
                {#each ROSTER_DUTY_TYPES as option (option.value)}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </label>
            <label>
              <span class="roster-label">Start</span>
              <input class="input-base" type="time" bind:value={entry.startTime} />
            </label>
            <label>
              <span class="roster-label">End</span>
              <input class="input-base" type="time" bind:value={entry.endTime} />
            </label>
            <label>
              <span class="roster-label">Remarks</span>
              <input class="input-base" bind:value={entry.remarks} placeholder="Optional" />
            </label>
            <button type="button" class="icon-btn" aria-label="Remove this day" onclick={() => removeEntry(entry.id)}>
              <Trash2 size={14} />
            </button>
          </div>
        {/each}
      {/if}

      <div class="banner banner-info" style="margin-top:10px">
        Changing a date to another month is rejected on save. Each date can appear only once.
      </div>
    </Card>
  {/if}
</div>

<Dialog
  open={pdfOpen}
  title="A4 roster PDF"
  subtitle="Generated on this device with vector text and a signature block."
  onclose={() => (pdfOpen = false)}
>
  <div class="form-grid">
    <Select
      label="Orientation"
      bind:value={pdfOptions.orientation}
      options={[
        { value: 'portrait', label: 'Portrait' },
        { value: 'landscape', label: 'Landscape' }
      ]}
    />
    <Field label="Printed title" bind:value={pdfOptions.title} />
    <Select
      label="Date format"
      bind:value={pdfOptions.dateFormat}
      options={DATE_FORMATS.map((format) => ({ value: format, label: format }))}
    />
  </div>
  <div class="stack-sm" style="margin:4px 0 8px">
    <Toggle bind:checked={pdfOptions.showEmployeeId} label="Show employee ID" />
    <Toggle bind:checked={pdfOptions.showDepartment} label="Show department" />
    <Toggle bind:checked={pdfOptions.showUnit} label="Show unit" />
    <Toggle bind:checked={pdfOptions.showRemarks} label="Show remarks" />
    <Toggle bind:checked={pdfOptions.showDutyType} label="Show duty type" />
    <Toggle bind:checked={pdfOptions.showSignatureBlock} label="Include signature block" />
  </div>

  {#if previewRows.length > 0}
    <div class="table-wrap">
      <table class="table-base">
        <thead><tr>{#each previewRows[0] as cell}<th>{cell}</th>{/each}</tr></thead>
        <tbody>
          {#each previewRows.slice(1) as row}
            <tr>{#each row as cell}<td>{cell}</td>{/each}</tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="tiny muted" style="margin:5px 0 0">Showing the first rows of the prepared table. The PDF contains every entry.</p>
  {:else}
    <p class="tiny muted">Add roster entries to preview the printed table.</p>
  {/if}

  <div class="row" style="margin-top:10px">
    <Button onclick={() => void downloadPdf()} disabled={!pdfData || !draft || draft.entries.length === 0}>
      <Download size={14} /> Download PDF
    </Button>
    <Button variant="ghost" onclick={() => (pdfOpen = false)}>Cancel</Button>
  </div>
</Dialog>
