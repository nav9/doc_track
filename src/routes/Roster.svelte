<script lang="ts">
  import { tick } from 'svelte';
  import {
    ClipboardCopy,
    ClipboardPaste,
    Download,
    FileUp,
    Sparkles,
    Upload
  } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Toggle from '../lib/components/ui/Toggle.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import Dialog from '../lib/components/ui/Dialog.svelte';
  import { prepareRosterPdfData } from '../lib/infrastructure/pdf/rosterData';
  import {
    downloadBlob,
    pickTextFile,
    readClipboard,
    writeClipboard
  } from '../lib/infrastructure/files/files';
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
    RosterFontFamily,
    UnitNumberStyle
  } from '../lib/domain/roster/types';
  import type { LeaveStatus } from '../lib/domain/leave/types';
  import type { ImportPreview } from '../lib/application/dto/version';
  import { messageOf } from '../lib/application/services/errors';
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
  let saving = $state(false);

  let doctorListOpen = $state(false);
  let doctorEditing = $state<string | null>(null);
  let doctorNameInput = $state<HTMLInputElement | null>(null);
  let doctorFormHighlight = $state(false);
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let doctorDraft = $state({
    prefix: 'Dr. ',
    name: '',
    employeeId: '',
    department: '',
    designation: '',
    unit: ''
  });

  let exportOpen = $state(false);
  let exportText = $state('');
  let exportBusy = $state(false);
  let importOpen = $state(false);
  let importText = $state('');
  let importPreview = $state<ImportPreview | null>(null);
  let importBusy = $state(false);
  let importOverwrite = $state(false);

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

  function rosterKey(y = year, m = month, department = activeDepartment): string {
    return `doctrack:roster-draft:${y}-${m}:${department
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}`;
  }

  function unitLabel(number: number): string {
    return unitOptions(draft?.unitCount ?? 4, draft?.unitStyle ?? 'roman')[number - 1] ?? String(number);
  }

  function blankEntryFor(
    roster: Pick<DutyRoster, 'year' | 'month' | 'department' | 'unitCount' | 'unitStyle'>,
    date: string
  ): RosterEntry {
    const unitCount = roster.unitCount ?? 4;
    const unitNumber = suggestedUnitForDate(date, unitCount);
    return {
      id: newId('rentry'),
      date,
      doctorId: null,
      doctorName: '',
      employeeId: '',
      department: roster.department,
      unit: unitOptions(unitCount, roster.unitStyle ?? 'roman')[unitNumber - 1] ?? String(unitNumber),
      unitNumber,
      startTime: nightTimes.start,
      endTime: nightTimes.end,
      dutyType: 'night',
      remarks: '',
      swapNote: '',
      dutyId: null
    };
  }

  function normaliseDraft(value: DutyRoster): DutyRoster {
    const unitCount = value.unitCount ?? 4;
    const style = value.unitStyle ?? 'roman';
    const byDate = new Map(value.entries.map((entry) => [entry.date, entry]));
    const entries = rosterDateRange(value).map((date) => {
      const existing = byDate.get(date);
      if (!existing) return blankEntryFor(value, date);
      const unitNumber = existing.unitNumber ?? suggestedUnitForDate(date, unitCount);
      return {
        ...existing,
        unitNumber,
        unit: existing.unit || unitOptions(unitCount, style)[unitNumber - 1] || String(unitNumber)
      };
    });
    return {
      ...value,
      unitCount,
      unitStyle: style,
      dateFormat: value.dateFormat ?? app.settings?.rosterDateFormat ?? 'dd MMM yyyy',
      fontFamily: value.fontFamily ?? 'helvetica',
      fontSize: value.fontSize ?? 8,
      showLeaveWarnings: value.showLeaveWarnings ?? true,
      leaveWarningStatuses: value.leaveWarningStatuses ?? ['planned', 'pending', 'approved'],
      entries
    };
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
    const latestDepartmentRoster = [...app.snapshot.rosters]
      .filter((roster) => roster.department.trim().toLowerCase() === department.toLowerCase())
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
        latestDepartmentRoster?.dateFormat ?? app.settings?.rosterDateFormat ?? 'dd MMM yyyy',
      fontFamily: latestDepartmentRoster?.fontFamily ?? 'helvetica',
      fontSize: latestDepartmentRoster?.fontSize ?? 8,
      showLeaveWarnings: latestDepartmentRoster?.showLeaveWarnings ?? true,
      leaveWarningStatuses: latestDepartmentRoster?.leaveWarningStatuses ?? [
        'planned',
        'pending',
        'approved'
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return normaliseDraft(next);
  }

  $effect(() => {
    const key = rosterKey(year, month, activeDepartment);
    app.snapshot.rosters;
    if (key !== loadedKey) {
      loadedKey = key;
      const nextDraft = buildDraft();
      draft = nextDraft;
      lastAutosaveText = JSON.stringify(nextDraft);
      selectedIds = [];
      autosavedAt = '';
    }
  });

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
    const timer = setTimeout(() => void autosave(text), 650);
    return () => clearTimeout(timer);
  });

  async function autosave(serialised: string): Promise<void> {
    if (!draft || !app.services) return;
    if (saving) {
      setTimeout(() => void autosave(serialised), 400);
      return;
    }
    saving = true;
    autosavedAt = 'Saving…';
    const current = JSON.parse(serialised) as DutyRoster;
    const saved = await app.perform(
      (services) => services.saveRoster(current, { syncDuties, allowIncomplete: true }),
      undefined
    );
    saving = false;
    if (saved) {
      lastAutosaveText = serialised;
      if (draft) {
        draft.id = saved.id;
        lastAutosaveText = JSON.stringify($state.snapshot(draft));
      }
      autosavedAt = `Saved ${new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      })}`;
    } else {
      autosavedAt = 'Not saved';
    }
  }

  const sortedEntries = $derived(
    draft
      ? [...draft.entries].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      : []
  );
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
  const allDaysPresent = $derived(
    Boolean(
      draft &&
        rosterDateRange(draft).every((date) =>
          draft?.entries.some((entry) => entry.date === date)
        )
    )
  );
  const canExport = $derived(Boolean(draft && allDaysPresent && errorCount === 0));

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
    draft.unitCount = Math.max(1, Math.min(12, Number(value) || 1));
  }

  function changeDateFormat(value: string) {
    if (draft) draft.dateFormat = value as DateFormat;
  }

  function openDoctorList(): void {
    doctorListOpen = true;
    void tick().then(() => doctorNameInput?.focus());
  }

  function clearDoctorForm(): void {
    const prefix = doctorDraft.prefix || 'Dr. ';
    doctorEditing = null;
    doctorDraft = {
      prefix,
      name: '',
      employeeId: '',
      department: draft?.department ?? '',
      designation: '',
      unit: ''
    };
    void tick().then(() => doctorNameInput?.focus());
  }

  function prefixOf(doctor: DoctorChoice): string {
    if (doctor.prefix?.trim()) return doctor.prefix.trim();
    const match = doctor.name.match(/^(Dr\.?|Prof\.?)\s+/i);
    return match ? match[0].trim() : 'Dr.';
  }

  function stripPrefix(name: string, prefix: string): string {
    const trimmed = name.trim();
    if (prefix && trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
      return trimmed.slice(prefix.length).trim();
    }
    return trimmed.replace(/^(Dr\.?|Prof\.?)\s+/i, '').trim();
  }

  function startEditDoctor(doctor: DoctorChoice) {
    const prefix = prefixOf(doctor);
    doctorEditing = doctor.id || null;
    doctorDraft = {
      prefix,
      name: stripPrefix(doctor.name, prefix),
      employeeId: doctor.employeeId,
      department: doctor.department,
      designation: doctor.designation,
      unit: doctor.unit
    };
    void tick().then(() => doctorNameInput?.focus());
  }

  function composedDoctorName(): string {
    const prefix = doctorDraft.prefix.trim();
    const name = doctorDraft.name.trim().replace(/^(Dr\.?|Prof\.?)\s+/i, '').trim();
    return `${prefix} ${name}`.replace(/\s+/g, ' ').trim();
  }

  async function saveDoctor() {
    if (!doctorDraft.name.trim() || !doctorDraft.employeeId.trim()) {
      app.notify('error', 'Enter the doctor’s name and employee ID.');
      return;
    }
    const name = composedDoctorName();
    const duplicate = app.snapshot.doctors.find(
      (doctor) =>
        doctor.id !== doctorEditing &&
        (doctor.employeeId.trim().toLowerCase() === doctorDraft.employeeId.trim().toLowerCase() ||
          doctor.name.trim().toLowerCase() === name.toLowerCase())
    );
    if (doctorEditing && duplicate) {
      app.notify('error', 'Another doctor already uses that name or employee ID.');
      return;
    }
    const targetId = doctorEditing ?? duplicate?.id;
    const wasEditing = Boolean(doctorEditing);
    let saved = false;
    await app.perform(
      async (services) => {
        await services.saveRosterDoctor({
          id: targetId,
          prefix: doctorDraft.prefix.trim(),
          name,
          employeeId: doctorDraft.employeeId,
          department: doctorDraft.department || draft?.department || '',
          designation: doctorDraft.designation,
          unit: doctorDraft.unit,
          profileId: duplicate?.profileId ?? null,
          notes: duplicate ? 'Updated from the roster doctor list.' : 'Added from the roster doctor list.'
        });
        saved = true;
      },
      wasEditing ? `${name} updated in the doctor list.` : `${name} added to the doctor list.`
    );
    if (!saved) return;
    doctorEditing = null;
    doctorDraft = {
      ...doctorDraft,
      name: '',
      employeeId: '',
      designation: '',
      unit: ''
    };
    doctorFormHighlight = true;
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => (doctorFormHighlight = false), 900);
    await tick();
    doctorNameInput?.focus();
  }

  async function removeDoctor(doctor: DoctorChoice) {
    if (!doctor.id) return;
    if (
      !window.confirm(
        `Remove ${doctor.name} from the central roster list? Current rows using this doctor will show a validation error.`
      )
    )
      return;
    await app.perform(
      (services) => services.deleteRosterDoctor(doctor.id),
      'Doctor removed. Any roster row using this doctor is marked invalid.'
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
    app.notify('info', 'Doctors assigned by the least-loaded available rotation.');
  }

  function copyPreviousMonth() {
    if (!draft) return;
    if (!previousRoster) {
      app.notify('info', 'There is no saved roster for the previous month.');
      return;
    }
    draft = normaliseDraft(shiftRosterMonth(previousRoster, year, month));
    app.notify('info', 'Previous month loaded. Dates and units were shifted to this month.');
  }

  const pdfOptions = $derived({
    ...DEFAULT_ROSTER_PDF_OPTIONS,
    orientation: 'portrait' as const,
    showSignatureBlock: false,
    dateFormat: draft?.dateFormat ?? app.settings?.rosterDateFormat ?? 'dd MMM yyyy'
  });

  const previewFont = $derived(
    draft?.fontFamily === 'times'
      ? '"Times New Roman", Times, serif'
      : draft?.fontFamily === 'courier'
        ? '"Courier New", Courier, monospace'
        : 'Helvetica, Arial, sans-serif'
  );

  async function downloadPdf() {
    if (!draft || !canExport) return;
    const { generateRosterPdf } = await import('../lib/infrastructure/pdf/rosterPdf');
    const data = prepareRosterPdfData(
      $state.snapshot(draft),
      pdfOptions,
      formatDate(app.today)
    );
    const blob = generateRosterPdf(data, `${draft.month}/${draft.year}`);
    downloadBlob(`DocTrack_Roster_${draft.year}_${pad2(draft.month)}.pdf`, blob);
    app.notify('success', 'PDF generated and downloaded successfully.');
  }

  async function openExport() {
    if (!draft || !canExport) return;
    exportBusy = true;
    const current = $state.snapshot(draft);
    const result = await app.perform(async (services) => {
      await services.selfDoctor();
      const saved = await services.saveRoster(current, {
        syncDuties,
        allowIncomplete: false
      });
      const exported = await services.exportText('roster', {
        rosterId: saved.id,
        label: `Duty roster ${saved.month}/${saved.year}`
      });
      return { saved, text: exported.text };
    });
    exportBusy = false;
    if (!result) return;
    if (draft) {
      draft.id = result.saved.id;
      lastAutosaveText = JSON.stringify($state.snapshot(draft));
    }
    exportText = result.text;
    exportOpen = true;
  }

  async function copyExport() {
    if (!exportText) return;
    try {
      await writeClipboard(exportText);
      app.notify('success', 'Roster export copied to the clipboard.');
    } catch (error) {
      app.notify('error', messageOf(error));
    }
  }

  function openImport() {
    importOpen = true;
    importText = '';
    importPreview = null;
    importOverwrite = false;
  }

  async function browseImport() {
    const file = await pickTextFile();
    if (!file) return;
    importText = file.text;
    await previewImport(file.text);
  }

  async function pasteImport() {
    importBusy = true;
    try {
      const text = await readClipboard();
      importText = text;
      await previewImport(text);
    } catch (error) {
      app.notify('error', messageOf(error));
    } finally {
      importBusy = false;
    }
  }

  async function previewImport(text = importText) {
    if (!app.services || !text.trim()) {
      app.notify('error', 'Paste or choose a DocTrack roster export first.');
      return;
    }
    importBusy = true;
    importPreview = null;
    importOverwrite = false;
    try {
      const preview = await app.services.previewImport(text);
      if (preview.kind !== 'roster' || !preview.snapshot.rosters[0]) {
        throw new Error('This data does not contain a duty roster.');
      }
      const imported = preview.snapshot.rosters[0];
      importOverwrite = app.snapshot.rosters.some(
        (roster) =>
          roster.year === imported.year &&
          roster.month === imported.month &&
          roster.department.trim().toLowerCase() === imported.department.trim().toLowerCase()
      );
      importPreview = preview;
    } catch (error) {
      app.notify('error', messageOf(error));
    } finally {
      importBusy = false;
    }
  }

  const importedRoster = $derived(importPreview?.snapshot.rosters[0] ?? null);
  const importedDoctors = $derived(importPreview?.snapshot.doctors ?? []);

  async function useImportedRoster() {
    if (!importPreview) return;
    const preview = importPreview;
    const result = await app.perform(
      (services) => services.importRoster(preview),
      'Roster imported. New doctors were added and existing doctor details were kept.'
    );
    if (!result) return;
    importOpen = false;
    importPreview = null;
    importText = '';
    year = result.roster.year;
    month = result.roster.month;
    activeDepartment = result.roster.department;
    loadedKey = '';
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

  function prefixDoctor(doctor: DoctorChoice): string {
    return prefixOf(doctor);
  }
</script>

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
        {#if autosavedAt}<span class="tiny muted">{autosavedAt}</span>{/if}
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
        <label class="field">
          <span class="field-label">Roster font</span>
          <select
            class="input-base"
            value={draft.fontFamily ?? 'helvetica'}
            onchange={(event) => {
              if (draft) draft.fontFamily = event.currentTarget.value as RosterFontFamily;
            }}
          >
            <option value="helvetica">Helvetica (sans serif)</option>
            <option value="times">Times New Roman (serif)</option>
            <option value="courier">Courier (monospace)</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Roster font size</span>
          <input
            class="input-base"
            type="number"
            min="7"
            max="12"
            step="0.5"
            value={draft.fontSize ?? 8}
            onchange={(event) => {
              if (draft) draft.fontSize = Math.max(7, Math.min(12, Number(event.currentTarget.value) || 8));
            }}
          />
        </label>
      </div>

      <div class="divider"></div>
      <div class="between">
        <div>
          <Toggle
            bind:checked={draft.showLeaveWarnings}
            label="Show leave warnings while building the roster"
            hint="Warnings appear in orange and never prevent autosave."
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

      <div class="between roster-settings-footer">
        <span class="tiny muted">
          {draft.entries.length} entries
          {#if errorCount || warningCount} · {errorCount} errors · {warningCount} warnings{/if}
        </span>
        <div class="row">
          {#if previousRoster}
            <Button size="sm" variant="secondary" onclick={copyPreviousMonth}>Use previous month</Button>
          {/if}
          <Button size="sm" variant="subtle" onclick={autoAssign} disabled={!draft || draft.entries.length === 0}>
            <Sparkles size={13} /> Auto assign doctors
          </Button>
          <Button size="sm" variant="subtle" onclick={openDoctorList}>Doctor names list</Button>
          <Button size="sm" variant="subtle" onclick={swapSelected} disabled={!canSwap}>
            Swap selected doctors
          </Button>
          <Button size="sm" variant="success" onclick={() => void downloadPdf()} disabled={!canExport || app.busy}>
            <Download size={13} /> Download as PDF
          </Button>
          <Button size="sm" variant="secondary" onclick={() => void openExport()} disabled={!canExport || exportBusy || app.busy}>
            <FileUp size={13} /> Export roster
          </Button>
          <Button size="sm" variant="secondary" onclick={openImport}>
            <Upload size={13} /> Import roster
          </Button>
        </div>
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
        <p>DOCTOR'S DUTY ROSTER FOR THE MONTH OF {formatMonthYear(year, month).toUpperCase()}</p>
      </div>

      {#if draft.entries.length === 0}
        <div class="empty">
          <strong>No days in this roster</strong>
          <span class="tiny muted">Every day of the month is generated automatically.</span>
        </div>
      {:else}
        <div
          class="duty-table"
          style={`font-family:${previewFont};font-size:${draft.fontSize ?? 8}pt`}
        >
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
        <div class="roster-note">Note: No alteration to be made without the permission of the undersigned</div>
      {/if}
    </Card>
  {/if}
</div>

<Dialog
  open={doctorListOpen}
  title="Doctor names list"
  subtitle={`${app.snapshot.doctors.length} saved doctors`}
  onclose={() => (doctorListOpen = false)}
>
  <div class="form-grid doctor-form" class:doctor-form-highlight={doctorFormHighlight}>
    <Field label="Prefix" bind:value={doctorDraft.prefix} placeholder="Dr. " />
    <label class="field">
      <span class="field-label">Doctor's name</span>
      <input
        bind:this={doctorNameInput}
        class="input-base"
        bind:value={doctorDraft.name}
        placeholder="Full name"
        autocomplete="off"
      />
    </label>
    <Field label="Employee ID" bind:value={doctorDraft.employeeId} placeholder="MC-..." />
    <Field label="Department" bind:value={doctorDraft.department} placeholder={draft?.department ?? ''} />
    <Field label="Designation" bind:value={doctorDraft.designation} placeholder="Senior Resident" />
    <Field label="Unit" bind:value={doctorDraft.unit} placeholder="Unit II" />
  </div>
  <div class="row" style="margin:8px 0">
    <Button size="sm" onclick={() => void saveDoctor()}>
      {doctorEditing ? 'Update doctor' : 'Add doctor'}
    </Button>
    <Button size="sm" variant="secondary" onclick={clearDoctorForm}>Clear</Button>
    {#if doctorEditing}<Button size="sm" variant="ghost" onclick={clearDoctorForm}>Cancel edit</Button>{/if}
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
  open={exportOpen}
  title="Export roster"
  subtitle="Read-only roster and doctor metadata for copying or saving."
  onclose={() => (exportOpen = false)}
>
  {#if draft}
    <div class="roster-transfer-scroll">
      <div class="roster-document-head roster-preview-head">
        <h2>DEPARTMENT OF {(draft.department || '—').toUpperCase()}</h2>
        <p>DOCTOR'S DUTY ROSTER FOR THE MONTH OF {formatMonthYear(draft.year, draft.month).toUpperCase()}</p>
      </div>
      <div class="table-wrap">
        <table class="table-base roster-meta-table">
          <thead><tr><th>Date</th><th>Day</th><th>Unit</th><th>Doctor</th><th>Employee ID</th></tr></thead>
          <tbody>
            {#each sortedEntries as entry (entry.id)}
              <tr>
                <td>{formatDate(entry.date, draft.dateFormat)}</td>
                <td>{DAY_NAMES[dayOfWeek(entry.date)]}</td>
                <td>{entry.unit}</td>
                <td>{entry.doctorName || '—'}</td>
                <td>{entry.employeeId || '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <h3>Doctor metadata</h3>
      <div class="table-wrap">
        <table class="table-base roster-meta-table">
          <thead><tr><th>Name</th><th>Employee ID</th><th>Department</th><th>Designation</th><th>Unit</th></tr></thead>
          <tbody>
            {#each departmentDoctors as doctor (doctor.id || doctor.name)}
              <tr>
                <td>{doctor.name}</td>
                <td>{doctor.employeeId || '—'}</td>
                <td>{doctor.department || '—'}</td>
                <td>{doctor.designation || '—'}</td>
                <td>{doctor.unit || '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
    <div class="row" style="margin-top:10px">
      <Button variant="success" onclick={() => void copyExport()}>
        <ClipboardCopy size={14} /> Copy to clipboard
      </Button>
      <Button variant="ghost" onclick={() => (exportOpen = false)}>Close</Button>
    </div>
  {/if}
</Dialog>

<Dialog
  open={importOpen}
  title="Import roster"
  subtitle="Review a roster and its doctor metadata before applying it."
  onclose={() => (importOpen = false)}
>
  <div class="row" style="margin-bottom:8px">
    <Button size="sm" variant="secondary" onclick={() => void browseImport()}>
      <Upload size={13} /> Browse
    </Button>
    <Button size="sm" variant="secondary" onclick={() => void pasteImport()} disabled={importBusy}>
      <ClipboardPaste size={13} /> Paste from clipboard
    </Button>
  </div>
  {#if importBusy}
    <p class="tiny muted">Reading roster data…</p>
  {/if}
  {#if importedRoster}
    {#if importOverwrite}
      <div class="banner banner-warning" style="margin-bottom:8px">
        <div>
          <strong>This replaces the existing roster.</strong>
          <div class="tiny">
            A roster already exists for {importedRoster.month}/{importedRoster.year} in
            {importedRoster.department}. Existing doctor records will not be overwritten.
          </div>
        </div>
      </div>
    {/if}
    <div class="roster-transfer-scroll">
      <div class="roster-document-head roster-preview-head">
        <h2>DEPARTMENT OF {(importedRoster.department || '—').toUpperCase()}</h2>
        <p>DOCTOR'S DUTY ROSTER FOR THE MONTH OF {formatMonthYear(importedRoster.year, importedRoster.month).toUpperCase()}</p>
      </div>
      <div class="table-wrap">
        <table class="table-base roster-meta-table">
          <thead><tr><th>Date</th><th>Day</th><th>Unit</th><th>Doctor</th><th>Employee ID</th></tr></thead>
          <tbody>
            {#each [...importedRoster.entries].sort((a, b) => a.date.localeCompare(b.date)) as entry (entry.id || entry.date)}
              <tr>
                <td>{formatDate(entry.date, importedRoster.dateFormat)}</td>
                <td>{DAY_NAMES[dayOfWeek(entry.date)]}</td>
                <td>{entry.unit}</td>
                <td>{entry.doctorName || '—'}</td>
                <td>{entry.employeeId || '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <h3>Doctor metadata</h3>
      <div class="table-wrap">
        <table class="table-base roster-meta-table">
          <thead><tr><th>Name</th><th>Employee ID</th><th>Department</th><th>Designation</th><th>Unit</th></tr></thead>
          <tbody>
            {#each importedDoctors as doctor (doctor.id || doctor.name)}
              <tr>
                <td>{doctor.name}</td>
                <td>{doctor.employeeId || '—'}</td>
                <td>{doctor.department || '—'}</td>
                <td>{doctor.designation || '—'}</td>
                <td>{doctor.unit || '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
    <div class="row" style="margin-top:10px">
      <Button variant="success" onclick={() => void useImportedRoster()} disabled={app.busy}>
        Use this data
      </Button>
      <Button variant="ghost" onclick={() => (importPreview = null)}>Cancel preview</Button>
    </div>
  {:else}
    <p class="tiny muted">
      Choose a DocTrack roster export file, or copy one to the clipboard and paste it here.
    </p>
  {/if}
</Dialog>
