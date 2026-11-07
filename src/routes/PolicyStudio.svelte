<script lang="ts">
  import { ShieldCheck } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import DateRangePicker from '../lib/components/ui/DateRangePicker.svelte';
  import Select from '../lib/components/ui/Select.svelte';
  import Toggle from '../lib/components/ui/Toggle.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import EmptyState from '../lib/components/ui/EmptyState.svelte';
  import { validatePolicyVersion } from '../lib/engines/policy-validation/validatePolicy';
  import {
    evaluateLeaveRequest,
    type LeaveEvaluation,
    type LeaveValidationContext
  } from '../lib/engines/leave-validation/leaveValidation';
  import { DATE_FORMATS, addDays, formatDate } from '../lib/domain/common/dates';
  import { newId } from '../lib/domain/common/ids';
  import {
    CONSEQUENCE_LABELS,
    RULE_TRIGGERS,
    TRIGGER_LABELS
  } from '../lib/domain/policy/types';
  import type {
    ConsequenceRule,
    LeaveCategoryRule,
    PolicyVersion,
    RuleTrigger
  } from '../lib/domain/policy/types';
  import type { ValidationIssue } from '../lib/domain/common/types';
  import { messageOf } from '../lib/application/services/errors';
  import { optionalNumber } from '../lib/app/ui';

  let policies = $state<PolicyVersion[]>([]);
  let draft = $state<PolicyVersion | null>(null);
  let issues = $state<ValidationIssue[]>([]);
  let message = $state('');
  let jsonText = $state('');
  let testCategory = $state('CL');
  let testStart = $state(app.today);
  let testEnd = $state(addDays(app.today, 1));
  let testResult = $state<LeaveEvaluation | null>(null);
  let testError = $state('');
  let showTestLab = $state(true);

  const active = $derived(app.activePolicy);
  const weekendLabels = [
    { day: 0, label: 'Sunday' },
    { day: 1, label: 'Monday' },
    { day: 2, label: 'Tuesday' },
    { day: 3, label: 'Wednesday' },
    { day: 4, label: 'Thursday' },
    { day: 5, label: 'Friday' },
    { day: 6, label: 'Saturday' }
  ];

  async function load() {
    if (!app.services) return;
    policies = (await app.services.listPolicies())
      .slice()
      .sort(
        (a, b) =>
          a.policyId.localeCompare(b.policyId) ||
          b.effectiveFrom.localeCompare(a.effectiveFrom) ||
          b.version - a.version
      );
  }

  $effect(() => {
    app.snapshot;
    void load();
  });

  $effect(() => {
    if (draft) jsonText = JSON.stringify(draft, null, 2);
  });

  async function startDraft(base?: PolicyVersion) {
    if (!app.services) return;
    const source = base ?? active ?? policies[0];
    draft = await app.services.createPolicyDraft(source ?? undefined);
    draft.id = newId('policyver');
    if (source) draft.effectiveFrom = source.effectiveFrom;
    issues = [];
    message = 'Draft created. Edit it, validate, then save or publish.';
    testCategory = draft.categories[0]?.code ?? 'CL';
    testResult = null;
  }

  function edit(version: PolicyVersion) {
    draft = $state.snapshot(version);
    if (!draft.id) draft.id = newId('policyver');
    issues = [];
    message =
      version.status === 'draft'
        ? 'Editing the saved draft.'
        : 'Editing a copy of a published version. Saving creates a new draft version, not an edit of the published one.';
  }

  function validateDraft(): ValidationIssue[] {
    if (!draft) return [];
    issues = validatePolicyVersion(draft).issues;
    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.filter((issue) => issue.severity === 'warning').length;
    message =
      errors > 0
        ? `${errors} error(s) must be fixed before publishing.`
        : warnings > 0
          ? `${warnings} warning(s) remain. Review them before publishing.`
          : 'Validation passed with no issues.';
    return issues;
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.id) draft.id = newId('policyver');
    const current = draft;
    const saved = await app.perform(
      (services) => services.savePolicyDraft(current).then(() => current),
      'Policy draft saved.'
    );
    if (saved) {
      draft = $state.snapshot(saved);
      await load();
    }
  }

  async function publish() {
    if (!draft) return;
    if (!draft.id) draft.id = newId('policyver');
    const found = validateDraft();
    if (found.some((issue) => issue.severity === 'error')) return;
    if (
      found.some((issue) => issue.severity === 'warning') &&
      !window.confirm('Validation warnings remain. Publish this version anyway?')
    ) {
      return;
    }
    const current = draft;
    const published = await app.perform(
      (services) => services.publishPolicy(current),
      'Policy published. New checks use this version from its effective date.'
    );
    if (published) {
      draft = null;
      issues = [];
      message = `Version ${published.version} is now published.`;
      await load();
    }
  }

  function applyJson() {
    if (!draft) return;
    try {
      const parsed = JSON.parse(jsonText) as PolicyVersion;
      draft = parsed;
      validateDraft();
      message = 'JSON applied to the draft.';
    } catch (error) {
      message = `JSON could not be read: ${messageOf(error)}`;
    }
  }

  function setNumberValue(target: object, key: string, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    (target as Record<string, unknown>)[key] = optionalNumber(input.value);
  }

  function setCooldown(category: LeaveCategoryRule, enabled: boolean) {
    category.cooldown = enabled
      ? {
          months: category.cooldown?.months ?? 3,
          from: 'episode-end',
          notes: category.cooldown?.notes ?? ''
        }
      : null;
  }

  function setEligibility(category: LeaveCategoryRule, enabled: boolean) {
    category.eligibility = enabled
      ? {
          minServiceMonths: category.eligibility?.minServiceMonths ?? 12,
          notes: category.eligibility?.notes ?? ''
        }
      : null;
  }

  function setExpiry(category: LeaveCategoryRule, enabled: boolean) {
    category.expiry = enabled
      ? {
          months: category.expiry?.months ?? 3,
          from: 'earned-date',
          boundary: category.expiry?.boundary ?? 'inclusive',
          notes: category.expiry?.notes ?? ''
        }
      : null;
  }

  function toggleWeekend(day: number, checked: boolean) {
    if (!draft) return;
    draft.work.weekendDays = checked
      ? [...new Set([...draft.work.weekendDays, day])].sort((a, b) => a - b)
      : draft.work.weekendDays.filter((value) => value !== day);
  }

  function setConfig(rule: ConsequenceRule, key: string, value: string | number | boolean | null) {
    rule.config = { ...rule.config, [key]: value };
  }

  async function runTest() {
    if (!draft || !app.services) {
      testError = 'Open a policy draft first.';
      return;
    }
    if (!app.services) return;
    testError = '';
    testResult = null;
    try {
      const base = await app.services.leaveContext();
      const simulated: PolicyVersion = { ...draft, status: 'published' };
      const scope: NonNullable<LeaveValidationContext['policyScope']> = {};
      if (simulated.organisationId) scope.organisationId = simulated.organisationId;
      if (simulated.department) scope.department = simulated.department;
      if (simulated.employmentType) scope.employmentType = simulated.employmentType;
      const context: LeaveValidationContext = {
        ...base.context,
        policyVersions: [simulated, ...base.context.policyVersions],
        policyScope: scope
      };
      testResult = evaluateLeaveRequest(
        { category: testCategory, startDate: testStart, endDate: testEnd, halfDay: null },
        context
      );
    } catch (error) {
      testError = messageOf(error);
    }
  }

  function triggerLabel(trigger: RuleTrigger): string {
    return TRIGGER_LABELS[trigger];
  }
</script>

<PageHeader
  title="Policy Studio"
  subtitle="Versioned, effective-dated rules. Publishing never edits history."
>
  <Button variant="secondary" onclick={() => startDraft()}>New draft from active policy</Button>
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

{#if message}
  <div class="banner banner-info" style="margin-bottom:12px">{message}</div>
{/if}

<div class="policy-layout">
  <div class="stack">
    {#if draft}
      <Card>
        <div class="section-card-head">
          <div class="row">
            <h2>{draft.id ? 'Edit policy draft' : 'New policy draft'}</h2>
            <Badge tone="warning">Draft</Badge>
            <Badge tone="neutral">v{draft.version}</Badge>
          </div>
          <div class="row">
            <Button size="sm" variant="secondary" onclick={validateDraft}>Validate</Button>
            <Button size="sm" variant="subtle" onclick={saveDraft}>Save draft</Button>
            <Button size="sm" onclick={publish}>Publish</Button>
            <Button size="sm" variant="ghost" onclick={() => { draft = null; issues = []; }}>Close</Button>
          </div>
        </div>

        <div class="form-grid">
          <Field label="Policy name" bind:value={draft.name} required />
          <Field label="Effective from" type="date" bind:value={draft.effectiveFrom} required />
          <Field label="Change summary" bind:value={draft.changeSummary} />
          <Select
            label="Status"
            value={draft.status}
            disabled
            options={[{ value: draft.status, label: draft.status }]}
          />
        </div>
        <Field label="Description" type="textarea" bind:value={draft.description} rows={2} />

        {#if issues.length > 0}
          <div class="divider"></div>
          <div class="stack-sm">
            {#each issues as issue (issue.code + issue.message)}
              <div class="reason reason-{issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'}">
                <div>
                  <strong>{issue.code}</strong> · {issue.message}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <details style="margin-top:10px">
          <summary class="small" style="cursor:pointer;font-weight:700">Working time and shifts</summary>
          <div class="form-grid" style="margin-top:7px">
            <Field label="Work day starts" type="time" bind:value={draft.work.workDayStart} />
            <Field label="Work day ends" type="time" bind:value={draft.work.workDayEnd} />
            <Field label="PDO punch-out cutoff" type="time" bind:value={draft.work.pdoPunchOutCutoff} />
            <Field
              label="NMC punches required"
              value={String(draft.work.nmcRequiredPunchesPerMonth)}
              oninput={(event) => {
                if (!draft) return;
                draft.work.nmcRequiredPunchesPerMonth = Math.max(
                  1,
                  Number(event.currentTarget.value) || 21
                );
              }}
            />
            <Select
              label="Academic year starts"
              value={String(draft.work.academicYearStartMonth)}
              onchange={(event) => {
                if (!draft) return;
                draft.work.academicYearStartMonth = Number(event.currentTarget.value) || 8;
              }}
              options={Array.from({ length: 12 }, (_, index) => ({
                value: String(index + 1),
                label: `Month ${index + 1}`
              }))}
            />
            <Select
              label="Roster date format"
              bind:value={draft.work.dateFormat}
              options={DATE_FORMATS.map((format) => ({ value: format, label: format }))}
            />
          </div>
          <div class="field">
            <span class="field-label">Weekend days</span>
            <div class="row">
              {#each weekendLabels as item (item.day)}
                <label class="toggle-row" style="padding:2px 6px">
                  <input
                    type="checkbox"
                    checked={draft.work.weekendDays.includes(item.day)}
                    onchange={(event) => toggleWeekend(item.day, event.currentTarget.checked)}
                  />
                  <span class="toggle-label">{item.label.slice(0, 3)}</span>
                </label>
              {/each}
            </div>
          </div>

          <div class="divider"></div>
          <h3 style="font-size:12px;margin-bottom:6px">Duty shifts</h3>
          <div class="stack-sm">
            {#each draft.shifts as shift (shift.id)}
              <div class="form-grid" style="border:1px solid var(--border);border-radius:9px;padding:8px">
                <Field label="Shift name" bind:value={shift.name} />
                <Select
                  label="Kind"
                  value={shift.kind}
                  onchange={(event) => {
                    const value = event.currentTarget.value;
                    shift.kind = value === 'day' || value === 'night' ? value : 'other';
                  }}
                  options={[
                    { value: 'day', label: 'Day' },
                    { value: 'night', label: 'Night' },
                    { value: 'other', label: 'Other' }
                  ]}
                />
                <Field label="Start" type="time" bind:value={shift.startTime} />
                <Field label="End" type="time" bind:value={shift.endTime} />
                <Field
                  label="Duration (hours)"
                  value={String(shift.durationHours)}
                  oninput={(event) => {
                    shift.durationHours = Math.max(1, Number(event.currentTarget.value) || 1);
                  }}
                />
                <Toggle bind:checked={shift.crossesMidnight} label="Crosses midnight" />
                <Toggle bind:checked={shift.qualifiesForCclOnHoliday} label="Qualifies for CCL on a holiday" />
              </div>
            {/each}
          </div>
        </details>

        <details style="margin-top:8px">
          <summary class="small" style="cursor:pointer;font-weight:700">Leave categories</summary>
          <div class="stack-sm" style="margin-top:7px">
            {#each draft.categories as category (category.code)}
              <details class="policy-cat card" style="padding:9px 10px">
                <summary class="between">
                  <div class="row">
                    <span class="chip cat-{category.code.toLowerCase()}">{category.code}</span>
                    <strong class="small">{category.fullForm}</strong>
                    {#if !category.enabled}<Badge tone="neutral">Disabled</Badge>{/if}
                  </div>
                  <span class="tiny muted">{category.entitlement.amount ?? '—'} {category.entitlement.unit} / {category.entitlement.period}</span>
                </summary>

                <div class="form-grid" style="margin-top:8px">
                  <Field label="Full form" bind:value={category.fullForm} />
                  <Field label="Description" bind:value={category.description} />
                  <Field
                    label="Entitlement"
                    value={category.entitlement.amount === null ? '' : String(category.entitlement.amount)}
                    oninput={(event) => setNumberValue(category.entitlement, 'amount', event)}
                    hint="Blank means no fixed credit."
                  />
                  <Select
                    label="Unit"
                    bind:value={category.entitlement.unit}
                    options={[
                      { value: 'days', label: 'Days' },
                      { value: 'months', label: 'Months' }
                    ]}
                  />
                  <Select
                    label="Period"
                    bind:value={category.entitlement.period}
                    options={[
                      { value: 'calendar-year', label: 'Calendar year' },
                      { value: 'academic-year', label: 'Academic year' },
                      { value: 'employment-year', label: 'Employment year' }
                    ]}
                  />
                  <Select
                    label="Credit timing"
                    bind:value={category.entitlement.creditTiming}
                    options={[
                      { value: 'year-start', label: 'At period start' },
                      { value: 'monthly', label: 'Monthly' },
                      { value: 'none', label: 'No credit (usage cap)' }
                    ]}
                  />
                  <Field
                    label="Usage cap"
                    value={category.entitlement.usageCap === null ? '' : String(category.entitlement.usageCap)}
                    oninput={(event) => setNumberValue(category.entitlement, 'usageCap', event)}
                  />
                  <Field
                    label="Max per month"
                    value={category.maxDaysPerMonth === null ? '' : String(category.maxDaysPerMonth)}
                    oninput={(event) => setNumberValue(category, 'maxDaysPerMonth', event)}
                  />
                  <Field
                    label="Max continuous days"
                    value={category.maxContinuousDays === null ? '' : String(category.maxContinuousDays)}
                    oninput={(event) => setNumberValue(category, 'maxContinuousDays', event)}
                  />
                  <Field
                    label="Minimum per request"
                    value={category.minDaysPerRequest === null ? '' : String(category.minDaysPerRequest)}
                    oninput={(event) => setNumberValue(category, 'minDaysPerRequest', event)}
                  />
                  <Select
                    label="Counting"
                    bind:value={category.counting}
                    options={[
                      { value: 'calendar-days', label: 'Calendar days' },
                      { value: 'working-days', label: 'Working days only' }
                    ]}
                  />
                </div>

                <div class="row" style="gap:14px">
                  <Toggle bind:checked={category.enabled} label="Enabled" />
                  <Toggle bind:checked={category.halfDay.allowed} label="Half day allowed" />
                  <Toggle bind:checked={category.entitlement.proratedInJoiningPeriod} label="Prorate joining period" />
                  <Toggle bind:checked={category.approval.required} label="Approval required" />
                  <Toggle bind:checked={category.retrospectiveAllowed} label="Retrospective allowed" />
                  <Toggle bind:checked={category.negativeBalanceAllowed} label="Negative balance allowed" />
                  <Toggle bind:checked={category.carryForward.allowed} label="Carry forward" />
                  <Toggle bind:checked={category.holidayTreatment.consumesWeekends} label="Consumes weekends" />
                  <Toggle bind:checked={category.holidayTreatment.consumesGeneralHolidays} label="Consumes general holidays" />
                </div>

                <div class="form-grid" style="margin-top:6px">
                  <div>
                    <Toggle
                      checked={Boolean(category.cooldown)}
                      label="Cooldown after an episode"
                      onchange={(event) => setCooldown(category, event.currentTarget.checked)}
                    />
                    {#if category.cooldown}
                      <Field
                        label="Cooldown months"
                        value={String(category.cooldown.months)}
                        oninput={(event) => {
                          if (category.cooldown) {
                            category.cooldown.months = Math.max(0, Number(event.currentTarget.value) || 0);
                          }
                        }}
                      />
                    {/if}
                  </div>
                  <div>
                    <Toggle
                      checked={Boolean(category.eligibility)}
                      label="Minimum service"
                      onchange={(event) => setEligibility(category, event.currentTarget.checked)}
                    />
                    {#if category.eligibility}
                      <Field
                        label="Service months"
                        value={String(category.eligibility.minServiceMonths)}
                        oninput={(event) => {
                          if (category.eligibility) {
                            category.eligibility.minServiceMonths = Math.max(0, Number(event.currentTarget.value) || 0);
                          }
                        }}
                      />
                    {/if}
                  </div>
                  <div>
                    <Toggle
                      checked={Boolean(category.expiry)}
                      label="Credits expire"
                      onchange={(event) => setExpiry(category, event.currentTarget.checked)}
                    />
                    {#if category.expiry}
                      <Field
                        label="Expiry months"
                        value={String(category.expiry.months)}
                        oninput={(event) => {
                          if (category.expiry) {
                            category.expiry.months = Math.max(0, Number(event.currentTarget.value) || 0);
                          }
                        }}
                      />
                    {/if}
                  </div>
                </div>

                <Field label="Notes" bind:value={category.notes} />
                <p class="tiny muted">Rule source: {category.source}</p>
              </details>
            {/each}
          </div>
        </details>

        <details style="margin-top:8px">
          <summary class="small" style="cursor:pointer;font-weight:700">Consequence rules</summary>
          <div class="stack-sm" style="margin-top:7px">
            {#each draft.rules as rule (rule.id)}
              <div class="card" style="padding:9px 10px">
                <div class="between">
                  <div class="row">
                    <Badge tone="info">{rule.trigger}</Badge>
                    <strong class="small">{rule.title}</strong>
                  </div>
                  <Toggle bind:checked={rule.enabled} label="Enabled" />
                </div>
                <p class="tiny muted" style="margin:3px 0 5px">{rule.description}</p>
                <div class="form-grid">
                  <Field label="Title" bind:value={rule.title} />
                  <Select
                    label="Trigger"
                    value={rule.trigger}
                    onchange={(event) => {
                      rule.trigger = event.currentTarget.value as RuleTrigger;
                    }}
                    options={RULE_TRIGGERS.map((trigger) => ({
                      value: trigger,
                      label: triggerLabel(trigger)
                    }))}
                  />
                </div>
                {#if rule.consequences.length > 0}
                  <div class="row" style="margin-bottom:5px">
                    {#each rule.consequences as consequence}
                      <Badge tone="neutral">{CONSEQUENCE_LABELS[consequence.type]}{#if consequence.category} · {consequence.category}{/if}</Badge>
                    {/each}
                  </div>
                {/if}
                {#if Object.keys(rule.config).length > 0}
                  <div class="form-grid">
                    {#each Object.entries(rule.config) as [key, value] (key)}
                      <label class="field">
                        <span class="field-label">{key}</span>
                        {#if typeof value === 'boolean'}
                          <input
                            type="checkbox"
                            checked={value}
                            onchange={(event) => setConfig(rule, key, event.currentTarget.checked)}
                          />
                        {:else if typeof value === 'number'}
                          <input
                            class="input-base"
                            type="number"
                            value={value}
                            oninput={(event) => setConfig(rule, key, Number(event.currentTarget.value))}
                          />
                        {:else}
                          <input
                            class="input-base"
                            value={value ?? ''}
                            oninput={(event) =>
                              setConfig(rule, key, event.currentTarget.value === '' ? null : event.currentTarget.value)}
                          />
                        {/if}
                      </label>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </details>

        <details style="margin-top:8px">
          <summary class="small" style="cursor:pointer;font-weight:700">Advanced JSON</summary>
          <p class="tiny muted" style="margin:5px 0">
            The complete typed policy object. Configuration only: no executable rules are accepted.
          </p>
          <textarea class="input-base mono" rows={12} bind:value={jsonText}></textarea>
          <div class="row" style="margin-top:6px">
            <Button size="sm" variant="secondary" onclick={applyJson}>Apply JSON to draft</Button>
          </div>
        </details>
      </Card>

      <Card>
        <div class="section-card-head">
          <h2>Policy test lab</h2>
          <Toggle bind:checked={showTestLab} label="Show" />
        </div>
        {#if showTestLab}
          {#if !draft}
            <p class="tiny muted">Open a draft to simulate a request against it.</p>
          {:else}
            <div class="form-grid">
              <Select
                label="Category"
                bind:value={testCategory}
                options={draft.categories.map((category) => ({
                  value: category.code,
                  label: `${category.code} — ${category.fullForm}`
                }))}
              />
              <DateRangePicker label="Test dates" bind:start={testStart} bind:end={testEnd} />
            </div>
            <div class="row">
              <Button size="sm" variant="secondary" onclick={runTest}>
                <ShieldCheck size={13} /> Simulate
              </Button>
              <span class="tiny muted">Uses this draft only; published data is unchanged.</span>
            </div>
            {#if testError}<div class="banner banner-danger" style="margin-top:8px">{testError}</div>{/if}
            {#if testResult}
              <div class="divider"></div>
              <div class="between">
                <Badge tone={testResult.status === 'possible' ? 'success' : testResult.status === 'conditional' ? 'warning' : 'danger'}>
                  {testResult.status}
                </Badge>
                <span class="tiny muted">{testResult.leaveDays} day(s) charged</span>
              </div>
              {#if testResult.reasons.length > 0}
                <ul class="reasons">
                  {#each testResult.reasons as reason (reason.code + reason.message)}
                    <li class="reason reason-{reason.severity}">{reason.message}</li>
                  {/each}
                </ul>
              {:else}
                <p class="tiny muted" style="margin:6px 0 0">No issues under this draft.</p>
              {/if}
            {/if}
          {/if}
        {:else}
          <p class="tiny muted">The test lab is hidden. Turn it on to simulate requests.</p>
        {/if}
      </Card>
    {:else}
      <EmptyState
        title="No policy draft open"
        text="Create a draft from the active policy, or edit a saved draft from the version list. Published versions are never modified."
      >
        <Button variant="secondary" onclick={() => startDraft()}>New draft from active policy</Button>
      </EmptyState>
    {/if}
  </div>

  <div class="stack">
    <Card>
      <div class="section-card-head"><h2>Active version</h2></div>
      {#if active}
        <dl class="detail-grid">
          <div><dt>Name</dt><dd>{active.name}</dd></div>
          <div><dt>Version</dt><dd>{active.version}</dd></div>
          <div><dt>Effective</dt><dd>{formatDate(active.effectiveFrom)}</dd></div>
          <div><dt>Published</dt><dd>{active.publishedAt ? formatDate(active.publishedAt.slice(0, 10)) : '—'}</dd></div>
          <div><dt>Policy ID</dt><dd class="mono">{active.policyId}</dd></div>
        </dl>
      {:else}
        <p class="tiny muted">No published policy.</p>
      {/if}
    </Card>

    <Card>
      <div class="section-card-head">
        <h2>All versions</h2>
        <span class="tiny muted">{policies.length}</span>
      </div>
      <div class="stack-sm">
        {#each policies as policy (policy.id)}
          <div class="list-row" style="align-items:flex-start">
            <Badge tone={policy.status === 'published' ? 'success' : policy.status === 'draft' ? 'warning' : 'neutral'}>
              {policy.status}
            </Badge>
            <div class="list-main">
              <div class="list-title">{policy.name} · v{policy.version}</div>
              <div class="tiny muted">
                From {formatDate(policy.effectiveFrom)}{#if policy.effectiveTo} to {formatDate(policy.effectiveTo)}{/if}
              </div>
              {#if policy.changeSummary}<div class="tiny muted">{policy.changeSummary}</div>{/if}
            </div>
            <Button size="sm" variant="ghost" onclick={() => edit(policy)}>Edit</Button>
          </div>
        {/each}
      </div>
      <p class="tiny muted" style="margin:8px 0 0">
        Editing a published version opens a copy. Publishing creates a new version with its own
        effective date; historical decisions keep the version they used.
      </p>
    </Card>

    <Card>
      <div class="section-card-head"><h2>Why versioned rules?</h2></div>
      <p class="tiny muted" style="margin:0">
        A leave decision must remain explainable years later. Each request stores the policy and
        version it was checked against, so changing a number never rewrites an old decision.
      </p>
    </Card>
  </div>
</div>
