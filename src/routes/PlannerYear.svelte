<script lang="ts">
  import { AlertTriangle, CalendarPlus, Download, Upload } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Select from '../lib/components/ui/Select.svelte';
  import Dialog from '../lib/components/ui/Dialog.svelte';
  import DateRangePicker from '../lib/components/ui/DateRangePicker.svelte';
  import CalendarMonth from '../lib/components/CalendarMonth.svelte';
  import { buildLeaveSuggestions } from '../lib/engines/planning-engine/leaveSuggestions';
  import {
    MONTH_NAMES,
    eachDate,
    formatDate,
    monthKey
  } from '../lib/domain/common/dates';
  import { isActiveLeave, leaveStatusLabel } from '../lib/domain/leave/types';
  import { isSharedLeaveActive } from '../lib/domain/multiuser/types';
  import { addMark, categoryChipClass, rangeText, statusTone, toneForCategory, type DayMark } from '../lib/app/ui';
  import { downloadText, pickTextFile } from '../lib/infrastructure/files/files';
  import type { ImportPreview } from '../lib/application/dto/version';
  import { messageOf } from '../lib/application/services/errors';

  let plannerYear = $state(Number(app.today.slice(0, 4)));
  let applyOpen = $state(false);
  let applyStart = $state(app.today);
  let applyEnd = $state(app.today);
  let applyCategory = $state('CL');
  let applyPurpose = $state('');
  let applyCovering = $state('');
  let applyNotes = $state('');
  let suggestionAnchor = $state<{ startDate: string; endDate: string } | null>(null);
  let importText = $state('');
  let preview = $state<ImportPreview | null>(null);
  let importBusy = $state(false);

  const profile = $derived(app.profile);
  const ownName = $derived(
    profile ? `${profile.prefix} ${profile.name}`.replace(/\s+/g, ' ').trim() : ''
  );
  const categoryOptions = $derived(
    app.categories
      .filter((category) => !['GH', 'LOP'].includes(category.code))
      .map((category) => ({ value: category.code, label: `${category.code} — ${category.fullForm}` }))
  );
  const categoriesForBalance = $derived(
    ['CL', 'EL', 'CCL', 'SPCL', 'RH'].filter((code) =>
      app.categories.some((category) => category.code === code)
    )
  );
  const ownLeaves = $derived(app.snapshot.leaves.filter(isActiveLeave));
  const myApplications = $derived(
    app.snapshot.sharedLeaves
      .filter(
        (leave) =>
          isSharedLeaveActive(leave) &&
          (leave.employeeId.trim().toLowerCase() === (profile?.employeeId ?? '').trim().toLowerCase() ||
            leave.doctorName.trim().toLowerCase() === ownName.toLowerCase())
      )
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
  );
  const pendingApplications = $derived(
    myApplications.filter((leave) => leave.status === 'pending' || leave.status === 'planned')
  );
  const confirmedDates = $derived([
    ...ownLeaves.filter((leave) => leave.status === 'approved').flatMap((leave) => eachDate(leave.startDate, leave.endDate)),
    ...myApplications.filter((leave) => leave.status === 'approved').flatMap((leave) => eachDate(leave.startDate, leave.endDate))
  ]);

  function assignedToMe(assignedTo: string[] | undefined): boolean {
    if (!assignedTo?.length || !profile) return false;
    const employee = profile.employeeId.trim().toLowerCase();
    return assignedTo.some(
      (item) =>
        item.trim().toLowerCase() === employee ||
        item.trim().toLowerCase() === ownName.toLowerCase()
    );
  }

  function marksFor(year: number, month: number): Record<string, DayMark[]> {
    const map: Record<string, DayMark[]> = {};
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = `${year}-${String(month).padStart(2, '0')}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
    const overlaps = (from: string, to: string) => from <= end && to >= start;

    for (const holiday of app.snapshot.holidays) {
      if (overlaps(holiday.date, holiday.date)) {
        addMark(map, holiday.date, holiday.kind, holiday.kind === 'GH' ? 'gh' : 'rh');
      }
    }
    for (const leave of app.snapshot.leaves) {
      if (!isActiveLeave(leave) || !overlaps(leave.startDate, leave.endDate)) continue;
      for (const date of eachDate(leave.startDate, leave.endDate)) {
        if (date >= start && date <= end) {
          addMark(
            map,
            date,
            leave.category,
            toneForCategory(leave.category),
            leave.status === 'approved' ? 'leave' : 'leave-pending'
          );
        }
      }
    }
    for (const leave of myApplications) {
      if (!overlaps(leave.startDate, leave.endDate)) continue;
      for (const date of eachDate(leave.startDate, leave.endDate)) {
        if (date >= start && date <= end) {
          addMark(
            map,
            date,
            `${leave.category}${leave.status === 'pending' ? '?' : ''}`,
            toneForCategory(leave.category),
            leave.status === 'approved' ? 'leave' : 'leave-pending'
          );
        }
      }
    }
    for (const duty of app.snapshot.duties) {
      if (duty.status !== 'cancelled' && overlaps(duty.date, duty.date)) {
        addMark(map, duty.date, 'Duty', 'duty');
      }
    }
    for (const event of app.snapshot.events) {
      const from = event.date;
      const to = event.endDate ?? event.date;
      if (!assignedToMe(event.assignedTo) || !overlaps(from, to)) continue;
      for (const date of eachDate(from, to)) {
        if (date >= start && date <= end) addMark(map, date, event.title, 'event');
      }
    }
    return map;
  }

  const monthMarks = $derived.by(() =>
    Array.from({ length: 12 }, (_, index) => marksFor(plannerYear, index + 1))
  );
  const suggestionRules = $derived.by(() => {
    const result = [];
    for (const code of ['CCL', 'CL']) {
      const rule = app.categories.find((category) => category.code === code && category.enabled);
      if (!rule) continue;
      const balance = app.balances[code];
      result.push({
        code,
        available: Math.max(0, (balance?.available ?? 0) - (balance?.pending ?? 0)),
        maxDaysPerMonth: rule.maxDaysPerMonth,
        minDaysPerRequest: rule.minDaysPerRequest
      });
    }
    return result;
  });
  const activeSuggestionAnchor = $derived(
    suggestionAnchor && suggestionAnchor.startDate.slice(0, 4) === String(plannerYear)
      ? suggestionAnchor
      : null
  );
  const suggestions = $derived(
    buildLeaveSuggestions({
      year: plannerYear,
      anchor: activeSuggestionAnchor,
      leaves: [
        ...ownLeaves.map((leave) => ({
          startDate: leave.startDate,
          endDate: leave.endDate,
          category: leave.category,
          status: leave.status
        })),
        ...myApplications.map((leave) => ({
          startDate: leave.startDate,
          endDate: leave.endDate,
          category: leave.category,
          status: leave.status
        }))
      ],
      holidays: app.snapshot.holidays,
      weekendDays: app.activePolicy?.work.weekendDays ?? [0, 6],
      rules: suggestionRules
    })
  );
  const cclCredits = $derived(
    app.snapshot.ledger
      .filter(
        (transaction) =>
          transaction.category === 'CCL' &&
          transaction.direction === 'credit' &&
          ['duty-ccl', 'pdo-conversion'].includes(transaction.source)
      )
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
      .slice(0, 8)
  );

  function openApply(date: string) {
    applyStart = date;
    applyEnd = date;
    applyCategory = categoryOptions.some((option) => option.value === 'CL')
      ? 'CL'
      : categoryOptions[0]?.value ?? 'CL';
    applyPurpose = '';
    applyCovering = '';
    applyNotes = '';
    applyOpen = true;
  }

  async function submitApplication() {
    if (!applyPurpose.trim()) {
      app.notify('error', 'Enter the purpose of the leave.');
      return;
    }
    if (!applyCovering.trim()) {
      app.notify('error', 'Enter the doctor who will cover your responsibilities.');
      return;
    }
    if (applyEnd < applyStart) {
      app.notify('error', 'The leave end date cannot be before the start date.');
      return;
    }
    const saved = await app.perform(
      (services) =>
        services.submitLeaveApplication({
          startDate: applyStart,
          endDate: applyEnd,
          category: applyCategory,
          status: 'pending',
          reason: applyPurpose,
          notes: applyNotes,
          purpose: applyPurpose,
          coveringDoctor: applyCovering,
          source: 'application'
        }),
      'Leave application submitted. It is awaiting HR approval.'
    );
    if (saved) {
      suggestionAnchor = { startDate: applyStart, endDate: applyEnd };
      applyOpen = false;
    }
  }

  async function exportApplications(approvedOnly: boolean) {
    await app.perform(async (services) => {
      const { text, filename } = await services.exportText('multiuser', {
        approvedOnly,
        label: approvedOnly ? 'Approved leave applications' : 'Leave applications'
      });
      downloadText(filename, text);
    }, approvedOnly ? 'Approved leave applications exported.' : 'Leave applications exported.');
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
      'Imported leaves are now available on your planner and calendar.'
    );
    if (result) {
      preview = null;
      importText = '';
    }
  }

  function monthRangeLabel(year: number, month: number): string {
    return `${MONTH_NAMES[month - 1]} ${year}`;
  }
</script>

<section class="planner-floating-balances" aria-label="Leave balances and applications">
  <div class="planner-floating-title">
    <div>
      <strong>Leave balances</strong>
      <span class="tiny muted">Floating while you scroll through the year</span>
    </div>
    <Button size="sm" variant="success" onclick={() => openApply(app.today)}>
      <CalendarPlus size={13} /> Apply for leave
    </Button>
  </div>
  <div class="planner-balance-list">
    {#each categoriesForBalance as code (code)}
      {@const balance = app.balances[code]}
      <p class="planner-balance-line">
        <strong class="planner-balance-code">{code}</strong>
        <span class="balance-available">{Math.round((balance?.available ?? 0) * 100) / 100} available</span>
        <span class="balance-used">{Math.round((balance?.used ?? 0) * 100) / 100} used</span>
        {#if (balance?.pending ?? 0) > 0}
          <span class="balance-pending">{Math.round((balance?.pending ?? 0) * 100) / 100} pending</span>
        {/if}
      </p>
    {/each}
  </div>
</section>

{#if pendingApplications.length > 0}
  <div class="banner banner-warning application-reminder">
    <AlertTriangle size={15} />
    <div>
      <strong>{pendingApplications.length} leave application{pendingApplications.length === 1 ? '' : 's'} awaiting approval</strong>
      <div class="tiny">
        {pendingApplications.map((leave) => `${rangeText(leave.startDate, leave.endDate)} · ${leave.category}`).join('; ')}
      </div>
    </div>
  </div>
{/if}

<div class="planner-year-toolbar">
  <div class="row">
    <label class="field" style="max-width:130px">
      <span class="field-label">Year</span>
      <input
        class="input-base"
        type="number"
        min="2000"
        max="2100"
        value={plannerYear}
        onchange={(event) => (plannerYear = Number(event.currentTarget.value) || plannerYear)}
      />
    </label>
    <span class="tiny muted">
      Solid-bordered chips are approved leave. After you submit a leave, dotted chips suggest nearby days that join a weekend, holiday or existing leave.
    </span>
  </div>
  <div class="row">
    <Button size="sm" variant="secondary" onclick={() => void exportApplications(false)}>
      <Download size={13} /> Export applications
    </Button>
    <Button size="sm" variant="secondary" onclick={() => void exportApplications(true)}>
      <Download size={13} /> Export approved
    </Button>
  </div>
</div>

<div class="planner-year-scroll" aria-label={`All months of ${plannerYear}`}>
  {#each Array.from({ length: 12 }, (_, index) => index + 1) as month (month)}
    <Card className="planner-year-month">
      <div class="section-card-head">
        <h2>{monthRangeLabel(plannerYear, month)}</h2>
        {#if monthMarks[month - 1] && Object.keys(monthMarks[month - 1]).length}
          <span class="tiny muted">{Object.keys(monthMarks[month - 1]).length} marked days</span>
        {/if}
      </div>
      <CalendarMonth
        year={plannerYear}
        month={month}
        hideHeader
        weekStartsOn={app.settings?.weekStartsOn ?? 1}
        marks={monthMarks[month - 1]}
        solidDates={confirmedDates}
        suggestedDates={Object.fromEntries(
          Object.entries(suggestions)
            .filter(([date]) => monthKey(date) === `${plannerYear}-${String(month).padStart(2, '0')}`)
            .map(([date, suggestion]) => [date, suggestion.label])
        )}
        onSelect={openApply}
      />
    </Card>
  {/each}
</div>

<div class="two-col" style="margin-top:12px">
  <Card>
    <div class="section-card-head">
      <div>
        <h2>My leave applications</h2>
        <span class="tiny muted">Pending applications stay highlighted until HR decides.</span>
      </div>
      <Badge tone={pendingApplications.length ? 'warning' : 'success'}>
        {pendingApplications.length ? `${pendingApplications.length} awaiting` : 'Up to date'}
      </Badge>
    </div>
    {#if myApplications.length === 0}
      <p class="tiny muted">No application submitted yet. Click a calendar day or use Apply for leave.</p>
    {:else}
      <div class="stack-sm">
        {#each myApplications as leave (leave.id)}
          <div class="application-row application-row-{leave.status}">
            <div class="row" style="flex-wrap:wrap">
              <span class={categoryChipClass(leave.category)}>{leave.category}</span>
              <strong class="small">{rangeText(leave.startDate, leave.endDate, app.settings?.dateFormat)}</strong>
              <Badge tone={statusTone(leave.status)}>{leaveStatusLabel(leave.status)}</Badge>
            </div>
            <div class="small"><strong>Purpose:</strong> {leave.purpose || leave.reason || '—'}</div>
            <div class="tiny muted">Covering doctor: {leave.coveringDoctor || '—'}</div>
            {#if leave.status === 'pending' || leave.status === 'planned'}
              <div class="tiny application-pending-note">Awaiting approval.</div>
            {/if}
            {#if leave.approvalNote}<div class="tiny muted">HR note: {leave.approvalNote}</div>{/if}
          </div>
        {/each}
      </div>
    {/if}
  </Card>

  <Card>
    <div class="section-card-head">
      <div>
        <h2>CCL earned from duty</h2>
        <span class="tiny muted">Duty dates behind your available CCL credits.</span>
      </div>
      <Badge tone="info">Ledger</Badge>
    </div>
    {#if cclCredits.length === 0}
      <p class="tiny muted">No duty-earned CCL credits are recorded yet.</p>
    {:else}
      <div class="stack-sm">
        {#each cclCredits as credit (credit.id)}
          <div class="list-row">
            <span class="chip cat-ccl">CCL</span>
            <div class="list-main">
              <div class="list-title">{formatDate(credit.effectiveDate, app.settings?.dateFormat)}</div>
              <div class="tiny muted">{credit.reason}</div>
            </div>
            <div class="tiny muted" style="text-align:right">
              +{credit.amount}<br />
              {#if credit.expiryDate}expires {formatDate(credit.expiryDate, app.settings?.dateFormat)}{/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </Card>
</div>

<Card className="application-import-card">
  <div class="section-card-head">
    <div>
      <h2>Import approved or submitted leaves</h2>
      <span class="tiny muted">Paste a DocTrack leave export. Approved leaves appear on the calendars immediately.</span>
    </div>
    <Badge tone="neutral">Local only</Badge>
  </div>
  <Field label="Paste a DocTrack export" type="textarea" bind:value={importText} rows={4} placeholder="-----BEGIN DOCTRACK DATA-----…" />
  <div class="row" style="margin-top:7px">
    <Button size="sm" variant="secondary" onclick={loadImportFile}><Upload size={13} /> Choose file</Button>
    <Button size="sm" onclick={previewImport} disabled={importBusy || !importText.trim()}>
      {importBusy ? 'Reading…' : 'Preview import'}
    </Button>
  </div>
  {#if preview}
    <div class="divider"></div>
    <div class="between">
      <strong>{preview.label}</strong>
      <Badge tone="info">{preview.kind}</Badge>
    </div>
    <p class="tiny muted" style="margin:4px 0">{preview.counts.sharedLeaves} leave application(s) in this file.</p>
    <div class="row">
      <Button size="sm" onclick={applyImport} disabled={app.busy}>Apply import</Button>
      <Button size="sm" variant="ghost" onclick={() => (preview = null)}>Cancel</Button>
    </div>
  {/if}
</Card>

<Dialog
  open={applyOpen}
  title="Apply for leave"
  subtitle="The application is sent to the HR approval queue on this device."
  onclose={() => (applyOpen = false)}
>
  <div class="form-grid">
    <Select label="Leave type" bind:value={applyCategory} options={categoryOptions} required />
    <DateRangePicker
      label="Leave dates"
      bind:start={applyStart}
      bind:end={applyEnd}
      required
      hint="The same day twice records one day."
    />
    <Field label="Purpose of leave" bind:value={applyPurpose} required placeholder="Why is the leave needed?" />
    <Field
      label="Person covering your responsibilities"
      bind:value={applyCovering}
      required
      placeholder="Dr. …"
    />
  </div>
  <Field label="Notes (optional)" type="textarea" bind:value={applyNotes} rows={2} />
  <div class="row" style="margin-top:9px">
    <Button variant="success" onclick={submitApplication} disabled={app.busy}>Submit application</Button>
    <Button variant="ghost" onclick={() => (applyOpen = false)}>Cancel</Button>
  </div>
</Dialog>
