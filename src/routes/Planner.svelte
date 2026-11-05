<script lang="ts">
  import { Search, Sparkles } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Select from '../lib/components/ui/Select.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import EmptyState from '../lib/components/ui/EmptyState.svelte';
  import {
    evaluateLeaveRequest,
    type LeaveEvaluation,
    type LeaveValidationContext
  } from '../lib/engines/leave-validation/leaveValidation';
  import {
    searchCandidates,
    type PlanCandidate
  } from '../lib/engines/planning-engine/planningEngine';
  import { planDuty } from '../lib/engines/duty-engine/dutyEngine';
  import { messageOf } from '../lib/application/services/errors';
  import { addDays, formatDate } from '../lib/domain/common/dates';
  import { HALF_DAY_LABELS, leaveStatusLabel } from '../lib/domain/leave/types';
  import type { LeaveStatus } from '../lib/domain/leave/types';
  import { pdoStatusLabel } from '../lib/domain/duty/types';
  import { categoryName, daysText, numberFrom, rangeText, statusTone } from '../lib/app/ui';

  let tab = $state<'search' | 'leave' | 'duty'>('search');
  let context = $state<LeaveValidationContext | null>(null);
  let contextError = $state('');

  async function refreshContext() {
    if (!app.services) return;
    try {
      const result = await app.services.leaveContext();
      context = result.context;
      contextError = '';
    } catch (error) {
      contextError = messageOf(error);
    }
  }

  $effect(() => {
    app.snapshot;
    app.settings;
    void refreshContext();
  });

  const categoryOptions = $derived(
    app.categories
      .filter((category) => category.code !== 'GH')
      .map((category) => ({
        value: category.code,
        label: `${category.code} — ${category.fullForm}`
      }))
  );

  // ------------------------------------------------------------------ leave form
  let category = $state('CL');
  let startDate = $state(app.today);
  let endDate = $state(app.today);
  let halfDay = $state<'' | 'first' | 'second'>('');
  let reason = $state('');
  let notes = $state('');
  let leaveStatus = $state<'planned' | 'pending' | 'approved'>('planned');

  const selectedRule = $derived(
    app.activePolicy?.categories.find((item) => item.code === category) ?? null
  );
  const halfDayAvailable = $derived(
    Boolean(selectedRule?.halfDay.allowed && startDate === endDate)
  );

  $effect(() => {
    if (!halfDayAvailable && halfDay !== '') halfDay = '';
  });

  const evaluation = $derived.by(() => {
    if (!context || !category || !startDate || !endDate || endDate < startDate) return null;
    try {
      return evaluateLeaveRequest(
        { category, startDate, endDate, halfDay: halfDay || null },
        context
      );
    } catch {
      return null;
    }
  });

  function verdictTone(status: LeaveEvaluation['status']) {
    switch (status) {
      case 'possible':
        return 'success' as const;
      case 'conditional':
        return 'warning' as const;
      case 'not-possible':
        return 'danger' as const;
      default:
        return 'info' as const;
    }
  }

  function verdictLabel(status: LeaveEvaluation['status']) {
    switch (status) {
      case 'possible':
        return 'Can be recorded';
      case 'conditional':
        return 'Needs attention';
      case 'not-possible':
        return 'Cannot be recorded';
      default:
        return 'Cannot determine';
    }
  }

  async function saveLeave() {
    const saved = await app.perform(
      (services) =>
        services.createLeave({
          category,
          startDate,
          endDate,
          halfDay: halfDay || null,
          status: leaveStatus as LeaveStatus,
          reason,
          notes,
          source: 'manual'
        }),
      'Leave recorded as planned. The ledger has been updated.'
    );
    if (saved) {
      reason = '';
      notes = '';
      halfDay = '';
    }
  }

  // --------------------------------------------------------------------- search
  let searchCategory = $state('CL');
  let windowStart = $state(app.today);
  let windowEnd = $state(addDays(app.today, 60));
  let minBreakDays = $state('0');
  let maxLeaveDays = $state('5');
  let results = $state<PlanCandidate[]>([]);
  let searchMessage = $state('');
  let hasSearched = $state(false);

  function runSearch() {
    if (!context) {
      searchMessage = contextError || 'The leave rules are still loading.';
      return;
    }
    try {
      results = searchCandidates(
        {
          startDate: windowStart,
          endDate: windowEnd,
          categories: [searchCategory],
          minBreakDays: numberFrom(minBreakDays) || undefined,
          maxLeaveDays: numberFrom(maxLeaveDays) || undefined
        },
        context
      ).slice(0, 12);
      hasSearched = true;
      searchMessage =
        results.length === 0
          ? 'No valid dates in this window for the selected rules. Try a longer window or another category.'
          : '';
    } catch (error) {
      results = [];
      hasSearched = true;
      searchMessage = messageOf(error);
    }
  }

  function useCandidate(candidate: PlanCandidate) {
    category = candidate.category;
    startDate = candidate.startDate;
    endDate = candidate.endDate;
    halfDay = '';
    tab = 'leave';
  }

  // ---------------------------------------------------------------------- duty
  const shifts = $derived(app.activePolicy?.shifts ?? []);
  let dutyDate = $state(app.today);
  let shiftId = $state('');
  let dutyStatus = $state<'planned' | 'completed'>('planned');
  let dutyRemarks = $state('');
  let swapDirection = $state<'' | 'gave-away' | 'took-over'>('');
  let swapOther = $state('');
  let swapCompensation = $state('');
  let swapReason = $state('');
  let pdoTimes = $state<Record<string, string>>({});

  $effect(() => {
    if (!shiftId && shifts.length > 0) shiftId = shifts[0].id;
  });

  const selectedShift = $derived(shifts.find((shift) => shift.id === shiftId) ?? null);

  const dutyPreview = $derived.by(() => {
    if (!selectedShift || !app.activePolicy) return null;
    return planDuty(
      {
        date: dutyDate,
        durationHours: selectedShift.durationHours,
        status: dutyStatus,
        startTime: selectedShift.startTime,
        endTime: selectedShift.endTime,
        crossesMidnight: selectedShift.crossesMidnight
      },
      { policy: app.activePolicy, holidays: app.snapshot.holidays }
    );
  });

  const duties = $derived(
    app.snapshot.duties
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, 24)
  );
  const openPdos = $derived(
    app.snapshot.pdos
      .filter((pdo) => pdo.status === 'scheduled')
      .sort((a, b) => a.date.localeCompare(b.date))
  );

  async function saveDuty() {
    const saved = await app.perform(
      (services) =>
        services.saveDuty({
          date: dutyDate,
          shiftId,
          status: dutyStatus,
          remarks: dutyRemarks,
          swapDirection: swapDirection || null,
          otherDoctorName: swapOther,
          compensationDate: swapCompensation || null,
          swapReason
        }),
      dutyStatus === 'completed'
        ? 'Duty saved. PDO and CCL consequences were applied from the policy.'
        : 'Duty saved to the calendar.'
    );
    if (saved) {
      dutyRemarks = '';
      swapDirection = '';
      swapOther = '';
      swapCompensation = '';
      swapReason = '';
    }
  }

  async function completeDuty(dutyId: string) {
    const duty = app.snapshot.duties.find((item) => item.id === dutyId);
    if (!duty) return;
    await app.perform(
      (services) =>
        services.saveDuty({
          id: duty.id,
          date: duty.date,
          shiftId: duty.shiftId,
          status: 'completed',
          remarks: duty.remarks,
          swapDirection: duty.swap?.direction ?? null,
          otherDoctorName: duty.swap?.otherDoctorName ?? '',
          compensationDate: duty.swap?.compensationDate ?? null,
          swapReason: duty.swap?.reason ?? ''
        }),
      'Duty marked completed. Check the PDO and CCL results.'
    );
  }

  async function reopenDuty(dutyId: string) {
    const duty = app.snapshot.duties.find((item) => item.id === dutyId);
    if (!duty) return;
    await app.perform(
      (services) =>
        services.saveDuty({
          id: duty.id,
          date: duty.date,
          shiftId: duty.shiftId,
          status: 'planned',
          remarks: duty.remarks
        }),
      'Duty returned to planned. Duty-earned CCL was reversed.'
    );
  }

  async function cancelDuty(dutyId: string) {
    if (!window.confirm('Cancel this duty? Any CCL earned from it will be reversed, not deleted.')) {
      return;
    }
    await app.perform((services) => services.cancelDuty(dutyId), 'Duty cancelled.');
  }

  async function resolvePdo(pdoId: string, action: 'worked' | 'unused' | 'approve') {
    const time =
      pdoTimes[pdoId] || app.activePolicy?.work.pdoPunchOutCutoff || '16:00';
    const result = await app.perform((services) => services.resolvePdo(pdoId, action, time));
    if (result) {
      app.notify(result.converted ? 'success' : 'info', result.message);
    }
  }

  const recentEvaluation = $derived(
    app.snapshot.leaves
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5)
  );
</script>

<PageHeader
  title="Leave planner"
  subtitle="Check the exact rules, search for better dates, and record leave or duty."
>
  <Badge tone="info">Policy v{app.activePolicy?.version ?? '—'}</Badge>
</PageHeader>

<div class="tabs" style="margin-bottom:12px" role="tablist" aria-label="Planner sections">
  <button
    type="button"
    class="tab"
    class:active={tab === 'search'}
    role="tab"
    aria-selected={tab === 'search'}
    onclick={() => (tab = 'search')}
  >
    Find dates
  </button>
  <button
    type="button"
    class="tab"
    class:active={tab === 'leave'}
    role="tab"
    aria-selected={tab === 'leave'}
    onclick={() => (tab = 'leave')}
  >
    Record leave
  </button>
  <button
    type="button"
    class="tab"
    class:active={tab === 'duty'}
    role="tab"
    aria-selected={tab === 'duty'}
    onclick={() => (tab = 'duty')}
  >
    Duties &amp; PDO
  </button>
</div>

{#if contextError}
  <div class="banner banner-danger" style="margin-bottom:12px">{contextError}</div>
{/if}
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

{#if tab === 'search'}
  <div class="stack">
    <Card>
      <div class="section-card-head">
        <h2>Search a window</h2>
        <span class="tiny muted">Every candidate is validated by the same rules as a real request.</span>
      </div>
      <div class="form-grid">
        <Select label="Leave category" bind:value={searchCategory} options={categoryOptions} />
        <Field label="Window starts" type="date" bind:value={windowStart} />
        <Field label="Window ends" type="date" bind:value={windowEnd} hint="Up to 92 days." />
        <Field
          label="Minimum break"
          type="text"
          bind:value={minBreakDays}
          hint="Days off in a row, including adjacent weekends and holidays. 0 = no minimum."
        />
        <Field label="Maximum leave days" type="text" bind:value={maxLeaveDays} hint="Leave days charged per option." />
      </div>
      <div class="row">
        <Button onclick={runSearch} disabled={!context}>
          <Search size={14} /> Search valid dates
        </Button>
        <span class="tiny muted">Ranked by break length, leave days used, expiring credits and NMC impact.</span>
      </div>
      {#if searchMessage}
        <div class="banner banner-warning" style="margin-top:9px">{searchMessage}</div>
      {/if}
    </Card>

    {#if hasSearched && results.length > 0}
      <div class="stack-sm">
        {#each results as candidate (candidate.id)}
          <Card>
            <div class="between">
              <div class="row">
                <span class="chip cat-{candidate.category.toLowerCase()}">{candidate.category}</span>
                <strong class="small">{rangeText(candidate.startDate, candidate.endDate, app.settings?.dateFormat)}</strong>
                <Badge tone={candidate.status === 'possible' ? 'success' : 'warning'}>
                  {candidate.status === 'possible' ? 'Valid' : 'Conditional'}
                </Badge>
              </div>
              <Badge tone="info">{candidate.score}/100</Badge>
            </div>
            <div class="tiny muted" style="margin-top:3px">
              {daysText(candidate.leaveDays)} leave charged · {candidate.breakDays}-day break including adjacent weekends and holidays
            </div>
            {#if candidate.reasons.filter((item) => item.severity !== 'info').length > 0}
              <ul class="reasons">
                {#each candidate.reasons.filter((item) => item.severity !== 'info').slice(0, 3) as reason}
                  <li class="reason reason-{reason.severity}">{reason.message}</li>
                {/each}
              </ul>
            {/if}
            <div class="row" style="margin-top:7px">
              <Button size="sm" onclick={() => useCandidate(candidate)}>Use these dates</Button>
            </div>
          </Card>
        {/each}
      </div>
    {:else if hasSearched}
      <EmptyState title="No valid dates found" text={searchMessage || 'Adjust the window or the category and search again.'} />
    {:else}
      <EmptyState
        title="Search around weekends and holidays"
        text="DocTrack only ranks dates that pass every hard rule: balance, monthly limit, EL cooldown, minimum episode length and NMC attendance."
      />
    {/if}
  </div>
{:else if tab === 'leave'}
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;align-items:start">
    <Card>
      <div class="section-card-head">
        <h2>Record leave</h2>
        <span class="tiny muted">{categoryName(app.activePolicy, category)}</span>
      </div>

      <div class="form-grid">
        <Select label="Leave category" bind:value={category} options={categoryOptions} required />
        <Field label="From" type="date" bind:value={startDate} required />
        <Field label="To" type="date" bind:value={endDate} required />
        {#if halfDayAvailable}
          <Select
            label="Half day"
            bind:value={halfDay}
            options={[
              { value: '', label: 'Full day' },
              { value: 'first', label: HALF_DAY_LABELS.first },
              { value: 'second', label: HALF_DAY_LABELS.second }
            ]}
            hint="Half-day leave is recorded as 0.5 day."
          />
        {:else if selectedRule?.halfDay.allowed}
          <div class="field">
            <span class="field-label">Half day</span>
            <p class="field-hint">Select the same date for From and To to record a half day.</p>
          </div>
        {/if}
        <Select
          label="Status"
          bind:value={leaveStatus}
          options={[
            { value: 'planned', label: 'Planned (not approved)' },
            { value: 'pending', label: 'Pending approval' },
            { value: 'approved', label: 'Approved' }
          ]}
          hint="Planned leave is shown as a suggestion, never as approved."
        />
        <Field label="Reason" bind:value={reason} placeholder="Short reason for the record" />
      </div>
      <Field label="Notes (optional)" type="textarea" bind:value={notes} rows={2} />

      {#if evaluation}
        <div class="divider"></div>
        <div class="between">
          <Badge tone={verdictTone(evaluation.status)}>{verdictLabel(evaluation.status)}</Badge>
          <span class="tiny muted">
            {daysText(evaluation.leaveDays)} charged · {evaluation.calendarDays} calendar day{evaluation.calendarDays === 1 ? '' : 's'}
          </span>
        </div>
        {#if evaluation.reasons.length > 0}
          <ul class="reasons">
            {#each evaluation.reasons as item (item.code + item.message)}
              <li class="reason reason-{item.severity}">{item.message}</li>
            {/each}
          </ul>
        {:else}
          <p class="tiny muted" style="margin:6px 0 0">No rule issues found for these dates.</p>
        {/if}

        <dl class="detail-grid" style="margin-top:9px">
          {#if evaluation.consequences.availableBefore !== null}
            <div><dt>Available before</dt><dd>{evaluation.consequences.availableBefore}</dd></div>
          {/if}
          {#if evaluation.consequences.availableAfter !== null}
            <div><dt>Available after</dt><dd>{evaluation.consequences.availableAfter}</dd></div>
          {/if}
          <div><dt>Approval</dt><dd>{evaluation.consequences.approvalRequired ? 'Required' : 'Not required'}</dd></div>
          {#if evaluation.consequences.dutyConflicts.length > 0}
            <div><dt>Duty conflicts</dt><dd>{evaluation.consequences.dutyConflicts.join(', ')}</dd></div>
          {/if}
          {#if evaluation.consequences.pdoDates.length > 0}
            <div><dt>PDO dates</dt><dd>{evaluation.consequences.pdoDates.join(', ')}</dd></div>
          {/if}
        </dl>

        {#if evaluation.consequences.attendance.length > 0}
          <div style="margin-top:8px">
            <div class="tiny muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.04em">NMC attendance impact</div>
            {#each evaluation.consequences.attendance as impact (impact.monthKey)}
              <div class="between tiny" style="margin-top:3px">
                <span>{impact.monthKey}: about {impact.projected} of {impact.required} punches</span>
                <Badge tone={impact.shortage ? 'warning' : 'success'}>
                  {impact.shortage ? 'Shortage' : 'OK'}
                </Badge>
              </div>
            {/each}
          </div>
        {/if}

        {#if evaluation.consequences.expiringCredits.length > 0}
          <div class="banner banner-warning" style="margin-top:8px">
            <div>
              <strong>Expiring credits would be used</strong>
              <div class="tiny">
                {#each evaluation.consequences.expiringCredits as credit (credit.creditId)}
                  {credit.amount} day(s) expiring {formatDate(credit.expiryDate)}{#if credit !== evaluation.consequences.expiringCredits.at(-1)}, {/if}
                {/each}
              </div>
            </div>
          </div>
        {/if}

        <div class="row" style="margin-top:10px">
          <Button
            onclick={saveLeave}
            disabled={app.busy || evaluation.status === 'not-possible' || evaluation.status === 'indeterminate'}
          >
            {leaveStatus === 'planned' ? 'Save as planned leave' : 'Record leave'}
          </Button>
          <span class="tiny muted">This does not seek approval; it records the request in your ledger.</span>
        </div>
      {:else}
        <p class="tiny muted">Choose a valid date range to see the rule check.</p>
      {/if}
    </Card>

    <div class="stack">
      <Card>
        <div class="section-card-head"><h2>Category at a glance</h2></div>
        {#if selectedRule}
          <dl class="detail-grid">
            <div><dt>Entitlement</dt><dd>{selectedRule.entitlement.amount ?? '—'} {selectedRule.entitlement.unit} / {selectedRule.entitlement.period.replace('-', ' ')}</dd></div>
            <div><dt>Monthly limit</dt><dd>{selectedRule.maxDaysPerMonth ?? 'None'}</dd></div>
            <div><dt>Longest episode</dt><dd>{selectedRule.maxContinuousDays ? `${selectedRule.maxContinuousDays} days` : 'Not limited'}</dd></div>
            <div><dt>Counting</dt><dd>{selectedRule.counting === 'calendar-days' ? 'Calendar days' : 'Working days only'}</dd></div>
            <div><dt>Half day</dt><dd>{selectedRule.halfDay.allowed ? 'Allowed' : 'Not allowed'}</dd></div>
            <div><dt>Approval</dt><dd>{selectedRule.approval.required ? 'Required' : 'Not required'}</dd></div>
          </dl>
          {#if selectedRule.notes}<p class="tiny muted" style="margin:7px 0 0">{selectedRule.notes}</p>{/if}
        {:else}
          <p class="tiny muted">Select a category to see its rule.</p>
        {/if}
      </Card>

      <Card>
        <div class="section-card-head"><h2>Recent leave records</h2></div>
        {#if recentEvaluation.length === 0}
          <p class="tiny muted">No leave has been recorded yet.</p>
        {:else}
          <div class="stack-sm">
            {#each recentEvaluation as leave (leave.id)}
              <div class="list-row">
                <span class="chip cat-{leave.category.toLowerCase()}">{leave.category}</span>
                <div class="list-main">
                  <div class="list-title">{rangeText(leave.startDate, leave.endDate, app.settings?.dateFormat)}</div>
                  <div class="tiny muted">{daysText(leave.leaveDays)} · {leaveStatusLabel(leave.status)}</div>
                </div>
                <Badge tone={statusTone(leave.status)}>{leave.status}</Badge>
              </div>
            {/each}
          </div>
        {/if}
      </Card>
    </div>
  </div>
{:else}
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;align-items:start">
    <div class="stack">
      <Card>
        <div class="section-card-head">
          <h2>Add or update a duty</h2>
          <Badge tone="neutral">24-hour duty creates a PDO</Badge>
        </div>
        {#if shifts.length === 0}
          <div class="banner banner-warning">No duty shifts are configured in the active policy.</div>
        {:else}
          <div class="form-grid">
            <Field label="Duty date" type="date" bind:value={dutyDate} />
            <Select
              label="Shift"
              bind:value={shiftId}
              options={shifts.map((shift) => ({ value: shift.id, label: `${shift.name} · ${shift.startTime}–${shift.endTime}` }))}
            />
            <Select
              label="Status"
              bind:value={dutyStatus}
              options={[
                { value: 'planned', label: 'Planned' },
                { value: 'completed', label: 'Completed (apply consequences)' }
              ]}
            />
            <Field label="Remarks" bind:value={dutyRemarks} placeholder="Optional" />
          </div>

          <details style="margin:4px 0 8px">
            <summary class="tiny muted" style="cursor:pointer">Record a duty swap</summary>
            <div class="form-grid" style="margin-top:6px">
              <Select
                label="Direction"
                bind:value={swapDirection}
                options={[
                  { value: '', label: 'No swap' },
                  { value: 'gave-away', label: 'I gave away this duty' },
                  { value: 'took-over', label: 'I took over this duty' }
                ]}
              />
              <Field label="Other doctor" bind:value={swapOther} placeholder="Name" />
              <Field label="Compensation date" type="date" bind:value={swapCompensation} />
              <Field label="Swap reason" bind:value={swapReason} placeholder="Optional" />
            </div>
          </details>

          {#if dutyPreview}
            <div class="banner banner-info">
              <div>
                <strong>Consequences from the active policy</strong>
                {#if dutyPreview.explanations.length > 0}
                  <ul class="reasons">
                    {#each dutyPreview.explanations as explanation}<li class="reason reason-info">{explanation}</li>{/each}
                  </ul>
                {:else}
                  <div class="tiny muted">No PDO or CCL is generated for this duty as entered.</div>
                {/if}
                {#each dutyPreview.notes as note}<div class="tiny muted">{note}</div>{/each}
              </div>
            </div>
          {/if}

          <div class="row" style="margin-top:8px">
            <Button onclick={saveDuty} disabled={app.busy || !shiftId}>
              {dutyStatus === 'completed' ? 'Save completed duty' : 'Save planned duty'}
            </Button>
          </div>
        {/if}
      </Card>

      <Card>
        <div class="section-card-head"><h2>Post-duty off</h2></div>
        {#if openPdos.length === 0}
          <p class="tiny muted">No scheduled PDO. A completed 24-hour duty creates one from the policy rule.</p>
        {:else}
          <div class="stack-sm">
            {#each openPdos as pdo (pdo.id)}
              <div class="list-row" style="align-items:flex-start">
                <span class="chip cat-pdo">PDO</span>
                <div class="list-main">
                  <div class="list-title">{formatDate(pdo.date, app.settings?.dateFormat)}</div>
                  <div class="tiny muted">{pdoStatusLabel(pdo.status)}</div>
                  <div class="row" style="margin-top:4px">
                    <input
                      class="input-base"
                      style="width:92px;padding:4px 6px;font-size:11px"
                      type="time"
                      aria-label="Punch-out time"
                      value={pdoTimes[pdo.id] ?? app.activePolicy?.work.pdoPunchOutCutoff ?? '16:00'}
                      oninput={(event) => (pdoTimes[pdo.id] = event.currentTarget.value)}
                    />
                    <Button size="sm" variant="secondary" onclick={() => void resolvePdo(pdo.id, 'worked')}>Worked</Button>
                    <Button size="sm" variant="subtle" onclick={() => void resolvePdo(pdo.id, 'unused')}>Unused → CCL</Button>
                    <Button size="sm" variant="ghost" onclick={() => void resolvePdo(pdo.id, 'approve')}>Approve</Button>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
        <p class="tiny muted" style="margin:7px 0 0">
          Working on a PDO and punching out by the cutoff converts it to CCL. Unused PDOs can be converted manually.
        </p>
      </Card>
    </div>

    <Card>
      <div class="section-card-head">
        <h2>Duty records</h2>
        <span class="tiny muted">{duties.length} shown</span>
      </div>
      {#if duties.length === 0}
        <EmptyState title="No duties recorded" text="Add the first duty on the left. Planned duties appear on the calendar immediately." />
      {:else}
        <div class="stack-sm">
          {#each duties as duty (duty.id)}
            <div class="list-row" style="align-items:flex-start">
              <span class="chip cat-duty">{formatDate(duty.date, 'dd MMM yyyy').slice(0, 6)}</span>
              <div class="list-main">
                <div class="list-title">{duty.shiftName}</div>
                <div class="tiny muted">
                  {duty.startTime} – {duty.endTime}{duty.crossesMidnight ? ' (+1 day)' : ''} · {duty.status}
                  {#if duty.qualifyingDay} · qualifying day{/if}
                </div>
                {#if duty.remarks}<div class="tiny muted">{duty.remarks}</div>{/if}
              </div>
              <div class="row" style="gap:3px">
                {#if duty.status === 'planned'}
                  <Button size="sm" variant="secondary" onclick={() => void completeDuty(duty.id)}>Complete</Button>
                {:else if duty.status === 'completed'}
                  <Button size="sm" variant="ghost" onclick={() => void reopenDuty(duty.id)}>Reopen</Button>
                {/if}
                {#if duty.status !== 'cancelled'}
                  <Button size="sm" variant="danger" onclick={() => void cancelDuty(duty.id)}>Cancel</Button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </Card>
  </div>
{/if}
