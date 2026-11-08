<script lang="ts">
  import { Download, Sparkles, Trash2 } from '@lucide/svelte';
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
  import {
    DATE_FORMATS,
    DAY_NAMES,
    MONTH_NAMES,
    dayOfWeek,
    formatDate,
    formatMonthYear
  } from '../lib/domain/common/dates';
  import type { DateFormat } from '../lib/domain/common/dates';
  import { DEFAULT_ROSTER_PDF_OPTIONS } from '../lib/domain/roster/types';
  import type {
    DutyRoster,
    RosterEntry,
    RosterPdfOptions,
    UnitNumberStyle
  } from '../lib/domain/roster/types';
  import type { LeaveStatus } from '../lib/domain/leave/types';
  import { newId } from '../lib/domain/common/ids';
  import {
    autoAssignDoctors,
    nextRosterMonth,
    rosterDateRange,
    shiftRosterMonth,
    suggestedUnitForDate,
    syncUnitLabels,
    syntheticSelfDoctor,
    unitOptions,
    validateRosterRow,
    type DoctorChoice
  } from '../lib/domain/roster/schedule';

  const initialMonth = nextRosterMonth(app.today);
  let year = $state(initialMonth.year);
  let month = $state(initialMonth.month);
  let activeDepartment = $state(
    app.employment?.department ?? app.profile?.department ?? ''
  );
  let draft = $state<DutyRoster | null>(null);
  let loadedKey = $state('');
  let syncDuties = $state(true);
  let selectedIds = $state<string[]>([]);
  let autosavedAt = $state('');
  let lastAutosaveText = '';
  let pdfOpen = $state(false);
  let doctorListOpen = $state(false);
  let pdfOptions = $state<RosterPdfOptions>({
    ...DEFAULT_ROSTER_PDF_OPTIONS,
    dateFormat: app.settings?.rosterDateFormat ?? DEFAULT_ROSTER_PDF_OPTIONS.dateFormat
  });

  let doctorEditing = $state<string | null>(null);
  let doctorDraft = $state({
    name: '',
    employeeId: '',
    department: '',
    designation: '',
    unit: ''
  });

  const profile = $derived(app.profile);
  const employment = $derived(app.employment);
  const pad2 = (value: number) => String(value).padStart(2, '0');
  const monthPrefix = $derived(`${year}-${pad2(month)}`);
  const defaultDoctorName = $derived(
    profile ? `${profile.prefix} ${profile.name}`.replace(/\s+/g, ' ').trim() : ''
  );
  const allDoctors = $derived.by<DoctorChoice[]>(() => {
    const list: DoctorChoice[] = [...app.snapshot.doctors];
    if (profile) {
      const exists = list.some(
        (doctor) =>
          doctor.profileId === profile.id ||
          (doctor.employeeId && doctor.employeeId === profile.employeeId) ||
          doctor.name.toLowerCase() === defaultDoctorName.toLowerCase()
      );
      if (!exists) {
        const self = syntheticSelfDoctor(profile, new Date().toISOString());
        if (self) list.unshift(self);
      }
    }
    return list;
  });
  const ownDoctor = $derived(
    allDoctors.find((doctor) => doctor.profileId === profile?.id) ?? null
  );
  const previousRoster = $derived.by(() => {
    const previousMonth = month === 1 ? 12 : month - 1;
    const previousYear = month === 1 ? year - 1 : year;
    return (
      app.snapshot.rosters.find(
        (roster) => roster.year === previousYear && roster.month === previousMonth
      ) ?? null
    );
  });
  const departmentDoctors = $derived(
    allDoctors
      .filter(
        (doctor) =>
          !draft?.department.trim() ||
          !doctor.department.trim() ||
          doctor.department.trim().toLowerCase() === draft.department.trim().toLowerCase()
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  );
  const nightTimes = $derived.by(() => {
    const shift =
      app.activePolicy?.shifts.find(
        (item) => item.kind === 'night' && item.durationHours === 24
      ) ?? app.activePolicy?.shifts[0];
    return { start: shift?.startTime ?? '09:00', end: shift?.endTime ?? '09:00' };
  });
  const unitChoices = $derived(
    unitOptions(draft?.unitCount ?? 4, draft?.unitStyle ?? 'roman')
  );
  const dateFormatOptions = $derived(
    DATE_FORMATS.map((format) => ({
      value: format,
      label: formatDate('2026-11-01', format)
    }))
  );
  const departmentOptions = $derived(
    [...new Set([
      activeDepartment,
      employment?.department ?? '',
      profile?.department ?? '',
      ...app.snapshot.doctors.map((doctor) => doctor.department),
      ...app.snapshot.rosters.map((roster) => roster.department)
    ].map((department) => department.trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
  );

  function departmentKey(department: string): string {
    return department.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function rosterKey(y = year, m = month, department = activeDepartment): string {
    return `doctrack:roster-draft:${y}-${m}:${departmentKey(department)}`;
  }

  function normaliseDraft(value: DutyRoster): DutyRoster {
    const unitCount = value.unitCount ?? 4;
    const style = value.unitStyle ?? 'roman';
    return {
      ...value,
      unitCount,
      unitStyle: style,
      dateFormat: value.dateFormat ?? app.settings?.rosterDateFormat ?? 'dd MMM yyyy',
      showLeaveWarnings: value.showLeaveWarnings ?? true,
      leaveWarningStatuses: value.leaveWarningStatuses ?? [
        'planned',
        'pending',
        'approved'
      ],
      entries: value.entries.map((entry) => {
        const unitNumber =
          entry.unitNumber ?? suggestedUnitForDate(entry.date, unitCount);
        return {
          ...entry,
          unitNumber,
          unit: entry.unit || unitOptions(unitCount, style)[unitNumber - 1] || String(unitNumber)
        };
      })
    };
  }

  function readCachedDraft(y: number, m: number, department: string): DutyRoster | null {
    try {
      const raw = window.localStorage.getItem(rosterKey(y, m, department));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as DutyRoster;
      if (parsed.year !== y || parsed.month !== m || !Array.isArray(parsed.entries)) return null;
      if (
        department.trim() &&
        parsed.department?.trim().toLowerCase() !== department.trim().toLowerCase()
      ) {
        return null;
      }
      return normaliseDraft(parsed);
    } catch {
      return null;
    }
  }

  function buildDraft(): DutyRoster {
    const department = activeDepartment.trim();
    const existing = app.snapshot.rosters.find(
      (roster) =>
        roster.year === year &&
        roster.month === month &&
        roster.department.trim().toLowerCase() === department.toLowerCase()
    );
    if (existing) return normaliseDraft($state.snapshot(existing));
    const cached = readCachedDraft(year, month, department);
    if (cached) return cached;
    const latestDepartmentRoster = [...app.snapshot.rosters]
      .filter(
        (roster) => roster.department.trim().toLowerCase() === department.toLowerCase()
      )
      .sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month))[0];
    const next: DutyRoster = {
      id: '',
      profileId: profile?.id ?? '',
      year,
      month,
      title: 'Night Duty Roster',
      department: department || employment?.department || profile?.department || '',
      unit: '',
      hospitalName: latestDepartmentRoster?.hospitalName || profile?.hospitalName || '',
      entries: [],
      notes: '',
      unitCount: latestDepartmentRoster?.unitCount ?? 4,
      unitStyle: latestDepartmentRoster?.unitStyle ?? 'roman',
      dateFormat:
        latestDepartmentRoster?.dateFormat ??
        app.settings?.rosterDateFormat ??
        'dd MMM yyyy',
      showLeaveWarnings: latestDepartmentRoster?.showLeaveWarnings ?? true,
      leaveWarningStatuses: latestDepartmentRoster?.leaveWarningStatuses ?? [
        'planned',
        'pending',
        'approved'
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    // Dates are generated on first creation; doctors remain blank for the
    // roster-maker to assign or for Auto assign to propose.
    next.entries = rosterDateRange(next).map((date) => {
      const unitNumber = suggestedUnitForDate(date, next.unitCount ?? 4);
      return {
        id: `${next.id || 'draft'}_${date}`,
        date,
        doctorId: null,
        doctorName: '',
        employeeId: '',
        department: next.department,
        unit: unitOptions(next.unitCount ?? 4, next.unitStyle ?? 'roman')[unitNumber - 1],
        unitNumber,
        startTime: nightTimes.start,
        endTime: nightTimes.end,
        dutyType: 'night',
        remarks: '',
        swapNote: '',
        dutyId: null
      };
    });
    return next;
  }

  $effect(() => {
    const key = rosterKey(year, month, activeDepartment);
    const rosters = app.snapshot.rosters;
    if (key !== loadedKey) {
      loadedKey = key;
      const nextDraft = buildDraft();
      draft = nextDraft;
      lastAutosaveText = JSON.stringify(nextDraft);
      selectedIds = [];
      autosavedAt = readCachedDraft(year, month, activeDepartment)
        ? 'Draft restored'
        : '';
    }
    void rosters;
  });

  // Keep a recoverable copy of incomplete work. A saved roster replaces it.
  $effect(() => {
    const current = draft;
    if (
      !current ||
      loadedKey !== rosterKey(current.year, current.month, current.department)
    ) {
      return;
    }
    const text = JSON.stringify($state.snapshot(current));
    if (text === lastAutosaveText) return;
    lastAutosaveText = text;
    try {
      window.localStorage.setItem(
        rosterKey(current.year, current.month, current.department),
        text
      );
      autosavedAt = `Saved ${new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      })}`;
    } catch {
      autosavedAt = 'Autosave unavailable';
    }
  });

  const sortedEntries = $derived(
    draft
      ? [...draft.entries].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      : []
  );
  const uncovered = $derived.by(() => {
    if (!draft) return 0;
    const covered = new Set(draft.entries.map((entry) => entry.date));
    let count = 0;
    for (let day = 1; day <= new Date(Date.UTC(year, month, 0)).getUTCDate(); day += 1) {
      if (!covered.has(`${monthPrefix}-${pad2(day)}`)) count += 1;
    }
    return count;
  });
  const issues = $derived.by(() => {
    const map = new Map<string, { level: 'error' | 'warning'; message: string } | null>();
    if (!draft) return map;
    for (const entry of draft.entries) {
      map.set(
        entry.id,
        validateRosterRow({
          entry,
          doctors: allDoctors,
          department: draft.department,
          unitCount: draft.unitCount ?? 4,
          showLeaveWarnings: draft.showLeaveWarnings ?? true,
          leaveStatuses: draft.leaveWarningStatuses ?? [],
          leaves: app.snapshot.leaves,
          sharedLeaves: app.snapshot.sharedLeaves,
          ownDoctor
        })
      );
    }
    return map;
  });
  const errorCount = $derived(
    [...issues.values()].filter((issue) => issue?.level === 'error').length
  );
  const warningCount = $derived(
    [...issues.values()].filter((issue) => issue?.level === 'warning').length
  );

  function blankEntry(date: string): RosterEntry {
    const unitNumber = suggestedUnitForDate(date, draft?.unitCount ?? 4);
    return {
      id: newId('rentry'),
      date,
      doctorId: null,
      doctorName: '',
      employeeId: '',
      department: draft?.department ?? '',
      unit: unitLabel(unitNumber),
      unitNumber,
      startTime: nightTimes.start,
      endTime: nightTimes.end,
      dutyType: 'night',
      remarks: '',
      swapNote: '',
      dutyId: null
    };
  }

  function unitLabel(number: number): string {
    return unitOptions(draft?.unitCount ?? 4, draft?.unitStyle ?? 'roman')[number - 1] ?? String(number);
  }

  function addEntry() {
    if (!draft) return;
    const used = new Set(draft.entries.map((entry) => entry.date));
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    let next = `${monthPrefix}-01`;
    for (let day = 1; day <= last; day += 1) {
      const candidate = `${monthPrefix}-${pad2(day)}`;
      if (!used.has(candidate)) {
        next = candidate;
        break;
      }
    }
    draft.entries = [...draft.entries, blankEntry(next)];
  }

  function doctorValue(entry: RosterEntry): string {
    const match = departmentDoctors.find(
      (doctor) =>
        doctor.id === entry.doctorId ||
        (doctor.employeeId &&
          entry.employeeId &&
          doctor.employeeId.toLowerCase() === entry.employeeId.toLowerCase()) ||
        doctor.name.toLowerCase() === entry.doctorName.trim().toLowerCase()
    );
    return match ? match.id || match.name : entry.doctorName;
  }

  function selectDoctor(entry: RosterEntry, value: string) {
    const doctor = departmentDoctors.find((item) => (item.id || item.name) === value);
    if (!doctor) {
      entry.doctorId = null;
      entry.doctorName = '';
      entry.employeeId = '';
      return;
    }
    entry.doctorId = doctor.id || null;
    entry.doctorName = doctor.name;
    entry.employeeId = doctor.employeeId;
    entry.department = doctor.department || draft?.department || '';
  }

  function selectUnit(entry: RosterEntry, value: string) {
    const index = unitChoices.indexOf(value);
    if (index < 0) return;
    entry.unitNumber = index + 1;
    entry.unit = value;
  }

  function changeUnitStyle(value: string) {
    if (!draft) return;
    const style = (value === 'number' || value === 'word' ? value : 'roman') as UnitNumberStyle;
    draft.unitStyle = style;
    draft.entries = syncUnitLabels(draft.entries, draft.unitCount ?? 4, style);
  }

  function changeUnitCount(value: string) {
    if (!draft) return;
    const count = Math.max(1, Math.min(12, Number(value) || 1));
    draft.unitCount = count;
  }

  function changeDateFormat(value: string) {
    if (!draft) return;
    draft.dateFormat = value as DateFormat;
    pdfOptions.dateFormat = value as DateFormat;
  }

  function addDoctor() {
    doctorEditing = null;
    doctorDraft = {
      name: '',
      employeeId: '',
      department: draft?.department ?? '',
      designation: '',
      unit: ''
    };
  }

  function startEditDoctor(doctor: DoctorChoice) {
    doctorEditing = doctor.id || null;
    doctorDraft = {
      name: doctor.name,
      employeeId: doctor.employeeId,
      department: doctor.department,
      designation: doctor.designation,
      unit: doctor.unit
    };
  }

  async function saveDoctor() {
    if (!doctorDraft.name.trim() || !doctorDraft.employeeId.trim()) {
      app.notify('error', 'Enter the doctor’s name and employee ID.');
      return;
    }
    const duplicate = app.snapshot.doctors.find(
      (doctor) =>
        doctor.id !== doctorEditing &&
        (doctor.employeeId.trim().toLowerCase() === doctorDraft.employeeId.trim().toLowerCase() ||
          doctor.name.trim().toLowerCase() === doctorDraft.name.trim().toLowerCase())
    );
    if (doctorEditing && duplicate) {
      app.notify('error', 'Another doctor already uses that name or employee ID.');
      return;
    }
    const targetId = doctorEditing ?? duplicate?.id;
    let saved = false;
    await app.perform(
      async (services) => {
        await services.saveRosterDoctor({
          id: targetId,
          name: doctorDraft.name,
          employeeId: doctorDraft.employeeId,
          department: doctorDraft.department || draft?.department || '',
          designation: doctorDraft.designation,
          unit: doctorDraft.unit,
          profileId: duplicate?.profileId ?? null,
          notes: duplicate ? 'Updated from the roster doctor list.' : 'Added from the roster doctor list.'
        });
        saved = true;
      },
      duplicate ? 'Existing doctor updated; no duplicate was created.' : 'Doctor saved to the central list.'
    );
    if (saved) {
      doctorEditing = null;
      doctorDraft = { name: '', employeeId: '', department: draft?.department ?? '', designation: '', unit: '' };
    }
  }

  async function removeDoctor(doctor: DoctorChoice) {
    if (!doctor.id) return;
    if (!window.confirm(`Remove ${doctor.name} from the central roster list? Current rows using this doctor will show a validation error.`)) return;
    await app.perform(
      (services) => services.deleteRosterDoctor(doctor.id),
      'Doctor removed. Any draft row using this doctor is marked invalid.'
    );
  }

  function toggleSelected(id: string, checked: boolean) {
    selectedIds = checked
      ? [...selectedIds, id]
      : selectedIds.filter((selected) => selected !== id);
  }

  const canSwap = $derived.by(() => {
    if (!draft || selectedIds.length !== 2) return false;
    const first = draft.entries.find((entry) => entry.id === selectedIds[0]);
    const second = draft.entries.find((entry) => entry.id === selectedIds[1]);
    if (!first?.doctorName.trim() || !second?.doctorName.trim()) return false;
    return (
      (first.doctorId || first.doctorName).toLowerCase() !==
      (second.doctorId || second.doctorName).toLowerCase()
    );
  });

  function swapSelected() {
    if (!draft || !canSwap) return;
    const first = draft.entries.find((entry) => entry.id === selectedIds[0]);
    const second = draft.entries.find((entry) => entry.id === selectedIds[1]);
    if (!first || !second) return;
    const swap = {
      doctorId: first.doctorId,
      doctorName: first.doctorName,
      employeeId: first.employeeId,
      department: first.department
    };
    first.doctorId = second.doctorId;
    first.doctorName = second.doctorName;
    first.employeeId = second.employeeId;
    first.department = second.department;
    second.doctorId = swap.doctorId;
    second.doctorName = swap.doctorName;
    second.employeeId = swap.employeeId;
    second.department = swap.department;
    const dateFormat = draft.dateFormat ?? app.settings?.rosterDateFormat;
    first.swapNote = `Swapped with ${formatDate(second.date, dateFormat)}`;
    second.swapNote = `Swapped with ${formatDate(first.date, dateFormat)}`;
    selectedIds = [];
    app.notify('success', 'The two selected doctors were swapped.');
  }

  function autoAssign() {
    if (!draft) return;
    draft.entries = autoAssignDoctors({
      entries: draft.entries,
      doctors: departmentDoctors,
      leaves: app.snapshot.leaves,
      sharedLeaves: app.snapshot.sharedLeaves,
      leaveStatuses: draft.leaveWarningStatuses ?? [],
      ownDoctor,
      department: draft.department,
      unitCount: draft.unitCount ?? 4,
      unitStyle: draft.unitStyle ?? 'roman'
    });
    app.notify('info', 'Doctors assigned by the least-loaded available rotation. Review leave warnings before saving.');
  }

  async function copyPreviousMonth() {
    if (!draft) return;
    if (!previousRoster) {
      app.notify('info', 'There is no saved roster for the previous month.');
      return;
    }
    draft = shiftRosterMonth(previousRoster, year, month);
    lastAutosaveText = JSON.stringify(draft);
    app.notify('info', 'Previous month loaded into this draft. Dates and units were shifted to this month.');
  }

  async function saveRoster() {
    if (!draft) return;
    if (errorCount > 0) {
      app.notify('error', `Fix ${errorCount} roster error${errorCount === 1 ? '' : 's'} before saving.`);
      return;
    }
    const current = $state.snapshot(draft);
    const saved = await app.perform(async (services) => {
      const snapshot = await services.snapshot();
      for (const entry of current.entries) {
        if (!entry.doctorName.trim()) continue;
        const existing = snapshot.doctors.find(
          (doctor) =>
            doctor.id === entry.doctorId ||
            (doctor.employeeId &&
              entry.employeeId &&
              doctor.employeeId.toLowerCase() === entry.employeeId.toLowerCase()) ||
            doctor.name.toLowerCase() === entry.doctorName.trim().toLowerCase()
        );
        if (!existing) {
          await services.saveRosterDoctor({
            name: entry.doctorName,
            employeeId: entry.employeeId,
            department: entry.department,
            unit: entry.unit,
            designation: '',
            profileId:
              entry.doctorName.trim().toLowerCase() === defaultDoctorName.toLowerCase()
                ? profile?.id ?? null
                : null,
            notes: 'Added while saving a roster.'
          });
        }
      }
      return services.saveRoster(current, { syncDuties });
    }, 'Roster saved.');
    if (saved) {
      try {
        window.localStorage.removeItem(
          rosterKey(saved.year, saved.month, saved.department)
        );
      } catch {
        // Local storage is optional; the IndexedDB record is authoritative.
      }
      lastAutosaveText = JSON.stringify(saved);
      autosavedAt = '';
      draft = $state.snapshot(saved);
    }
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
    draft
      ? prepareRosterPdfData(
          draft,
          {
            ...pdfOptions,
            dateFormat:
              draft.dateFormat ?? app.settings?.rosterDateFormat ?? pdfOptions.dateFormat
          },
          formatDate(app.today)
        )
      : null
  );
  const previewRows = $derived(pdfData ? rosterPreviewLines(pdfData) : []);

  async function downloadPdf() {
    if (!pdfData || !draft) return;
    const { generateRosterPdf } = await import('../lib/infrastructure/pdf/rosterPdf');
    const blob = generateRosterPdf(pdfData, `${draft.month}/${draft.year}`);
    downloadBlob(`DocTrack_Roster_${draft.year}_${pad2(draft.month)}.pdf`, blob);
    pdfOpen = false;
    app.notify('success', 'A4 roster PDF generated on this device.');
  }

  function issueFor(id: string) {
    return issues.get(id) ?? null;
  }

  function ownEntry(entry: RosterEntry): boolean {
    return (
      entry.doctorId === ownDoctor?.id ||
      entry.doctorName.trim().toLowerCase() === defaultDoctorName.toLowerCase()
    );
  }
</script>

<PageHeader
  title="Duty roster"
  subtitle="Night-duty roster with department units, leave checks and a printable A4 sheet."
>
  <Badge tone={errorCount > 0 ? 'danger' : warningCount > 0 ? 'warning' : 'success'}>
    {errorCount > 0
      ? `${errorCount} error${errorCount === 1 ? '' : 's'}`
      : warningCount > 0
        ? `${warningCount} warning${warningCount === 1 ? '' : 's'}`
        : uncovered > 0
          ? `${uncovered} day${uncovered === 1 ? '' : 's'} uncovered`
          : 'Roster ready'}
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
        <h2>Roster settings</h2>
        <Badge tone={draft?.id ? 'success' : 'neutral'}>{draft?.id ? 'Saved' : 'Draft'}</Badge>
        {#if autosavedAt}<span class="tiny muted">Autosave: {autosavedAt}</span>{/if}
      </div>
      <div class="row">
        {#if previousRoster}
          <Button size="sm" variant="secondary" onclick={copyPreviousMonth}>Use previous month</Button>
        {/if}
        <Button size="sm" variant="subtle" onclick={autoAssign} disabled={!draft || draft.entries.length === 0}>
          <Sparkles size={13} /> Auto assign doctors
        </Button>
        <Button size="sm" variant="subtle" onclick={() => (doctorListOpen = true)}>
          Doctor names list
        </Button>
        <Button size="sm" variant="subtle" onclick={swapSelected} disabled={!canSwap}>
          Swap selected doctors
        </Button>
        <Button size="sm" variant="subtle" onclick={() => (pdfOpen = true)} disabled={!draft || draft.entries.length === 0 || errorCount > 0}>
          <Download size={13} /> PDF preview
        </Button>
      </div>
    </div>

    {#if draft}
      <div class="form-grid">
        <label class="field">
          <span class="field-label">Month</span>
          <select
            class="input-base"
            value={month}
            onchange={(event) => (month = Number(event.currentTarget.value))}
          >
            {#each MONTH_NAMES as name, index (name)}
              <option value={index + 1}>{name}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span class="field-label">Year</span>
          <input
            class="input-base"
            type="number"
            min="2000"
            max="2100"
            value={year}
            onchange={(event) => (year = Number(event.currentTarget.value) || year)}
          />
        </label>
        <label class="field">
          <span class="field-label">Department</span>
          <input
            class="input-base"
            list="roster-department-options"
            value={activeDepartment}
            placeholder="e.g. Orthopaedics"
            onchange={(event) => {
              const value = event.currentTarget.value.trim();
              if (!value || value === activeDepartment) return;
              activeDepartment = value;
            }}
          />
          <datalist id="roster-department-options">
            {#each departmentOptions as option (option)}
              <option value={option}></option>
            {/each}
          </datalist>
          <span class="tiny muted">Choose an existing department or type a new one.</span>
        </label>
        <Field label="Hospital / college" bind:value={draft.hospitalName} />
        <label class="field">
          <span class="field-label">Number of units</span>
          <input
            class="input-base"
            type="number"
            min="1"
            max="12"
            value={draft.unitCount ?? 4}
            onchange={(event) => changeUnitCount(event.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span class="field-label">Unit numbering</span>
          <select
            class="input-base"
            value={draft.unitStyle ?? 'roman'}
            onchange={(event) => changeUnitStyle(event.currentTarget.value)}
          >
            <option value="roman">Roman — I, II, III</option>
            <option value="number">Numbers — 1, 2, 3</option>
            <option value="word">Words — One, Two, Three</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Date format on screen and PDF</span>
          <select
            class="input-base"
            value={draft.dateFormat ?? 'dd MMM yyyy'}
            onchange={(event) => changeDateFormat(event.currentTarget.value)}
          >
            {#each dateFormatOptions as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
      </div>

      <div class="divider"></div>
      <div class="between">
        <div>
          <Toggle
            bind:checked={draft.showLeaveWarnings}
            label="Show leave warnings while building the roster"
            hint="Warnings appear in orange and never prevent saving unless the doctor or unit is invalid."
          />
          {#if draft.showLeaveWarnings}
            <div class="row" style="margin:2px 0 6px 24px">
              <span class="tiny muted">Warn for:</span>
              {#each [
                { value: 'planned' as LeaveStatus, label: 'Planned' },
                { value: 'pending' as LeaveStatus, label: 'Pending' },
                { value: 'approved' as LeaveStatus, label: 'Approved' }
              ] as option (option.value)}
                <label class="tiny row-tight" style="cursor:pointer">
                  <input
                    type="checkbox"
                    checked={(draft.leaveWarningStatuses ?? []).includes(option.value)}
                    onchange={(event) => {
                      const list = new Set(draft?.leaveWarningStatuses ?? []);
                      if (event.currentTarget.checked) list.add(option.value);
                      else list.delete(option.value);
                      if (draft) draft.leaveWarningStatuses = [...list];
                    }}
                  />
                  {option.label}
                </label>
              {/each}
            </div>
          {/if}
        </div>
        <Toggle
          bind:checked={syncDuties}
          label="Create my own duty records"
          hint="Only your own name is synced to the planner; other doctors' rows are left untouched."
        />
      </div>

      <div class="row" style="margin-top:8px">
        <Button onclick={saveRoster} disabled={app.busy || errorCount > 0}>Save roster</Button>
        <Button variant="secondary" onclick={addEntry}>Add a day</Button>
        <span class="tiny muted">
          {draft.entries.length} entries · {uncovered} uncovered
          {#if errorCount || warningCount} · {errorCount} errors · {warningCount} warnings{/if}
        </span>
        <Button variant="ghost" onclick={() => void deleteRoster()}><Trash2 size={13} /> Delete this roster</Button>
      </div>
    {/if}
  </Card>

  {#if draft}
    <Card>
      <div class="section-card-head">
        <h2>Roster preview</h2>
        <span class="tiny muted">Select two rows to swap doctors</span>
      </div>
      <div class="roster-document-head">
        <h2>DEPARTMENT OF {(draft.department || '—').toUpperCase()}</h2>
        <p>
          DOCTOR'S DUTY ROSTER FOR THE MONTH OF
          {formatMonthYear(year, month).toUpperCase()}
        </p>
        {#if draft.hospitalName}<span>{draft.hospitalName}</span>{/if}
      </div>

      {#if draft.entries.length === 0}
        <div class="empty">
          <strong>No days entered</strong>
          <span class="tiny muted">Use “Add a day”, then let auto-assignment propose doctors or choose them row by row.</span>
        </div>
      {:else}
        <div class="duty-table">
          <div class="duty-row duty-head">
            <span></span>
            <span>Date</span>
            <span>Days</span>
            <span>Unit</span>
            <span>Doctor's name</span>
          </div>
          {#each sortedEntries as entry (entry.id)}
            {@const issue = issueFor(entry.id)}
            <div class="duty-entry" class:own-doctor={ownEntry(entry)}>
              <div
                class="duty-row"
                class:row-error={issue?.level === 'error'}
                class:row-warning={issue?.level === 'warning'}
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${formatDate(entry.date)} for swapping`}
                  checked={selectedIds.includes(entry.id)}
                  onchange={(event) => toggleSelected(entry.id, event.currentTarget.checked)}
                />
                <span class="duty-date">
                  {formatDate(entry.date, draft.dateFormat ?? app.settings?.rosterDateFormat)}
                </span>
                <span class="duty-day">{DAY_NAMES[dayOfWeek(entry.date)]}</span>
                <select
                  class="input-base duty-unit"
                  value={entry.unit}
                  onchange={(event) => selectUnit(entry, event.currentTarget.value)}
                >
                  {#each unitChoices as unit (unit)}
                    <option value={unit}>{unit}</option>
                  {/each}
                </select>
                <select
                  class="input-base"
                  value={doctorValue(entry)}
                  onchange={(event) => selectDoctor(entry, event.currentTarget.value)}
                >
                  <option value="">— Select doctor —</option>
                  {#each departmentDoctors as doctor (doctor.id || doctor.name)}
                    <option value={doctor.id || doctor.name}>{doctor.name}</option>
                  {/each}
                </select>
              </div>
              {#if issue}
                <div class:error-text={issue.level === 'error'} class:warning-text={issue.level === 'warning'}>
                  {issue.message}
                </div>
              {/if}
            </div>
          {/each}
        </div>
        <div class="roster-note">
          Note: No alteration to be made without the permission of the undersigned
        </div>
      {/if}
    </Card>

  {/if}
</div>

<Dialog
  open={doctorListOpen}
  title="Doctor names list"
  subtitle={`${app.snapshot.doctors.length} saved doctors · used by every month`}
  onclose={() => (doctorListOpen = false)}
>
  <div class="between" style="margin-bottom:8px">
    <span class="tiny muted">Names and employee IDs are checked before adding, so no duplicate is created.</span>
    <Button size="sm" variant="secondary" onclick={addDoctor}>New doctor</Button>
  </div>
  <div class="form-grid">
    <Field label="Doctor's name" bind:value={doctorDraft.name} placeholder="Dr. Full name" />
    <Field label="Employee ID" bind:value={doctorDraft.employeeId} placeholder="MC-..." />
    <Field label="Department" bind:value={doctorDraft.department} placeholder={draft?.department ?? ''} />
    <Field label="Designation" bind:value={doctorDraft.designation} placeholder="Senior Resident" />
    <Field label="Unit" bind:value={doctorDraft.unit} placeholder="Unit II" />
  </div>
  <div class="row" style="margin-bottom:8px">
    <Button size="sm" onclick={() => void saveDoctor()}>{doctorEditing ? 'Update doctor' : 'Add doctor'}</Button>
    {#if doctorEditing}<Button size="sm" variant="ghost" onclick={addDoctor}>Cancel edit</Button>{/if}
  </div>
  {#if app.snapshot.doctors.length === 0}
    <p class="tiny muted">No doctors in the central list yet. Auto-assignment uses your own profile until you add more.</p>
  {:else}
    <div class="stack-sm">
      {#each [...app.snapshot.doctors].sort((a, b) => a.name.localeCompare(b.name)) as doctor (doctor.id)}
        <div class="list-row">
          <div class="list-main">
            <div class="list-title">{doctor.name}</div>
            <div class="tiny muted">
              {doctor.employeeId || 'No employee ID'} · {doctor.department || 'No department'}{#if doctor.designation} · {doctor.designation}{/if}
            </div>
          </div>
          <Button size="sm" variant="ghost" onclick={() => startEditDoctor(doctor)}>Edit</Button>
          <Button size="sm" variant="danger" onclick={() => void removeDoctor(doctor)}>Remove</Button>
        </div>
      {/each}
    </div>
  {/if}
</Dialog>

<Dialog
  open={pdfOpen}
  title="A4 roster PDF"
  subtitle="Department and month headings, four columns, then signature and stamp space."
  onclose={() => (pdfOpen = false)}
>
  {#if draft}
    <div class="form-grid">
      <Select
        label="Orientation"
        bind:value={pdfOptions.orientation}
        options={[
          { value: 'portrait', label: 'Portrait' },
          { value: 'landscape', label: 'Landscape' }
        ]}
      />
      <label class="field">
        <span class="field-label">Date format</span>
        <select
          class="input-base"
          value={draft.dateFormat ?? 'dd MMM yyyy'}
          onchange={(event) => changeDateFormat(event.currentTarget.value)}
        >
          {#each dateFormatOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>
    </div>
    <Toggle bind:checked={pdfOptions.showSignatureBlock} label="Leave signature space" />

    {#if pdfData}
      <div class="roster-document-head roster-preview-head">
        <h2>{pdfData.departmentHeading}</h2>
        <p>{pdfData.rosterHeading}</p>
        {#if pdfData.hospital}<span>{pdfData.hospital}</span>{/if}
      </div>
    {/if}

    {#if previewRows.length > 0}
      <div class="table-wrap roster-preview-scroll">
        <table class="table-base">
          <thead><tr>{#each previewRows[0] as cell}<th>{cell}</th>{/each}</tr></thead>
          <tbody>
            {#each previewRows.slice(1) as row}
              <tr>{#each row as cell}<td>{cell}</td>{/each}</tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if pdfData}<p class="roster-note">{pdfData.footerNote}</p>{/if}
      <p class="tiny muted" style="margin:5px 0 0">Scroll to inspect every row. The PDF contains every date.</p>
    {:else}
      <p class="tiny muted">Add roster entries to preview the printed table.</p>
    {/if}

    <div class="row" style="margin-top:10px">
      <Button onclick={() => void downloadPdf()} disabled={!pdfData || !draft || draft.entries.length === 0}>
        <Download size={14} /> Download PDF
      </Button>
      <Button variant="ghost" onclick={() => (pdfOpen = false)}>Cancel</Button>
    </div>
  {/if}
</Dialog>
