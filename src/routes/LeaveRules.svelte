<script lang="ts">
  import { ShieldCheck } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import EmptyState from '../lib/components/ui/EmptyState.svelte';
  import {
    CONSEQUENCE_LABELS,
    TRIGGER_LABELS
  } from '../lib/domain/policy/types';
  import { formatDate } from '../lib/domain/common/dates';
  import { categoryChipClass } from '../lib/app/ui';

  const policy = $derived(app.activePolicy);
  const categories = $derived(policy?.categories.filter((category) => category.enabled) ?? []);
  const dateFormat = $derived(app.settings?.dateFormat ?? 'dd MMM yyyy');

  function yesNo(value: boolean): string {
    return value ? 'Yes' : 'No';
  }

  function configText(value: string | number | boolean | null): string {
    if (value === null) return 'not set';
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    return String(value);
  }
</script>

<PageHeader
  title="Leave rules"
  subtitle={
    policy
      ? `${policy.name} · version ${policy.version} · effective from ${formatDate(policy.effectiveFrom, dateFormat)}`
      : 'No published policy is active'
  }
>
  <a class="btn btn-secondary btn-sm" href="#/admin/policy-studio">
    <ShieldCheck size={13} /> Open Policy Studio
  </a>
</PageHeader>

{#if !policy}
  <EmptyState
    title="No active policy"
    text="Publish a policy version in the Policy Studio before recording leave."
  />
{:else}
  <div class="banner banner-info" style="margin-bottom:12px">
    <div>
      <strong>Read this as the department rule, not as approval.</strong>
      <p class="tiny muted" style="margin:2px 0 0">
        The app checks every request against this published version and records the outcome. A
        planned leave remains planned until the department approves it. Where the circular is
        silent, the Policy Studio setting is shown with a note.
      </p>
    </div>
  </div>

  <div class="stack">
    {#each categories as category (category.code)}
      <Card>
        <div class="between" style="align-items:flex-start">
          <div class="row" style="align-items:flex-start">
            <span class={categoryChipClass(category.code)}>{category.code}</span>
            <div>
              <h2 style="font-size:0.98rem">{category.fullForm}</h2>
              <p class="tiny muted" style="margin:2px 0 0">{category.description}</p>
            </div>
          </div>
          <div class="row">
            {#if category.approval.required}<Badge tone="warning">Approval required</Badge>{:else}<Badge tone="neutral">No approval</Badge>{/if}
            {#if category.negativeBalanceAllowed}<Badge tone="danger">Negative allowed</Badge>{/if}
          </div>
        </div>

        <dl class="detail-grid" style="margin-top:10px">
          <div>
            <dt>Entitlement</dt>
            <dd>
              {category.entitlement.amount ?? '—'} {category.entitlement.unit} per
              {category.entitlement.period.replace('-', ' ')}
              {#if category.entitlement.usageCap !== null}
                · use at most {category.entitlement.usageCap}
              {/if}
            </dd>
          </div>
          <div><dt>Counting</dt><dd>{category.counting === 'calendar-days' ? 'Calendar days' : 'Working days only'}</dd></div>
          <div><dt>Maximum per month</dt><dd>{category.maxDaysPerMonth ?? 'No monthly limit'}</dd></div>
          <div><dt>Longest single episode</dt><dd>{category.maxContinuousDays ? `${category.maxContinuousDays} days` : 'No limit'}</dd></div>
          <div><dt>Minimum per request</dt><dd>{category.minDaysPerRequest ? `${category.minDaysPerRequest} days` : 'None'}</dd></div>
          <div><dt>Half day</dt><dd>{category.halfDay.allowed ? 'Allowed (0.5 day)' : 'Not allowed'}</dd></div>
          <div><dt>Cooldown</dt><dd>{category.cooldown ? `${category.cooldown.months} months after the episode ends` : 'None'}</dd></div>
          <div><dt>Minimum service</dt><dd>{category.eligibility ? `${category.eligibility.minServiceMonths} months` : 'None'}</dd></div>
          <div>
            <dt>Expiry</dt>
            <dd>
              {#if category.expiry}
                {category.expiry.months} months from the earned date ({category.expiry.boundary})
              {:else}No expiry{/if}
            </dd>
          </div>
          <div>
            <dt>Carry forward</dt>
            <dd>
              {#if category.carryForward.allowed}
                Yes{#if category.carryForward.maxDays}, up to {category.carryForward.maxDays} days{/if}
              {:else}No — unused days lapse{/if}
            </dd>
          </div>
          <div><dt>Retrospective</dt><dd>{yesNo(category.retrospectiveAllowed)}</dd></div>
          <div><dt>Weekends &amp; holidays</dt><dd>{category.holidayTreatment.consumesWeekends ? 'Consumed' : 'Not consumed'}{category.holidayTreatment.consumesGeneralHolidays ? ' · general holidays consumed' : ''}</dd></div>
        </dl>

        {#if category.entitlement.notes || category.halfDay.notes || category.approval.notes || category.notes || category.cooldown?.notes || category.eligibility?.notes || category.expiry?.notes}
          <ul class="reasons" style="margin-top:8px">
            {#if category.entitlement.notes}<li class="reason reason-info">{category.entitlement.notes}</li>{/if}
            {#if category.halfDay.notes}<li class="reason reason-info">{category.halfDay.notes}</li>{/if}
            {#if category.cooldown?.notes}<li class="reason reason-info">{category.cooldown.notes}</li>{/if}
            {#if category.eligibility?.notes}<li class="reason reason-info">{category.eligibility.notes}</li>{/if}
            {#if category.expiry?.notes}<li class="reason reason-info">{category.expiry.notes}</li>{/if}
            {#if category.approval.notes}<li class="reason reason-info">{category.approval.notes}</li>{/if}
            {#if category.notes}<li class="reason reason-warning">{category.notes}</li>{/if}
          </ul>
        {/if}

        <p class="tiny muted" style="margin:8px 0 0">Source: {category.source}</p>
      </Card>
    {/each}

    <Card>
      <div class="section-card-head"><h2>Duty, PDO and CCL consequences</h2></div>
      <div class="stack-sm">
        {#each policy.rules.filter((rule) => rule.enabled) as rule (rule.id)}
          <div class="list-row" style="align-items:flex-start">
            <span class="chip cat-duty">{rule.trigger}</span>
            <div class="list-main">
              <div class="list-title">{rule.title}</div>
              <div class="tiny muted">{rule.description}</div>
              <div class="tiny muted" style="margin-top:2px">
                When {TRIGGER_LABELS[rule.trigger].toLowerCase()}
              </div>
              {#if rule.consequences.length > 0}
                <div class="row" style="margin-top:3px">
                  {#each rule.consequences as consequence}
                    <Badge tone="info">
                      {CONSEQUENCE_LABELS[consequence.type]}{#if consequence.category} · {consequence.category}{/if}{#if consequence.amount} · {consequence.amount}{/if}
                    </Badge>
                  {/each}
                </div>
              {/if}
              {#if Object.keys(rule.config).length > 0}
                <div class="tiny muted" style="margin-top:3px">
                  {#each Object.entries(rule.config) as [key, value] (key)}
                    {key}: {configText(value)}{#if key !== Object.keys(rule.config).at(-1)}, {/if}
                  {/each}
                </div>
              {/if}
              {#if rule.notes}<div class="tiny" style="color:var(--warning);margin-top:2px">{rule.notes}</div>{/if}
            </div>
          </div>
        {/each}
      </div>
    </Card>

    <div class="grid-2">
      <Card>
        <div class="section-card-head"><h2>Working time</h2></div>
        <dl class="detail-grid">
          <div><dt>Working day</dt><dd>{policy.work.workDayStart} – {policy.work.workDayEnd}</dd></div>
          <div><dt>PDO punch-out cutoff</dt><dd>{policy.work.pdoPunchOutCutoff}</dd></div>
          <div><dt>NMC punches</dt><dd>{policy.work.nmcRequiredPunchesPerMonth} per month</dd></div>
          <div><dt>Academic year starts</dt><dd>Month {policy.work.academicYearStartMonth}</dd></div>
          <div><dt>Weekend days</dt><dd>{policy.work.weekendDays.join(', ')} (0 = Sunday)</dd></div>
          <div><dt>Unused PDO conversion</dt><dd>{policy.work.unusedPdoConversionMonths === null ? 'Manual' : `After ${policy.work.unusedPdoConversionMonths} months`}</dd></div>
        </dl>
      </Card>
      <Card>
        <div class="section-card-head"><h2>Shifts</h2></div>
        <div class="stack-sm">
          {#each policy.shifts as shift (shift.id)}
            <div class="list-row">
              <span class="chip cat-duty">{shift.kind}</span>
              <div class="list-main">
                <div class="list-title">{shift.name}</div>
                <div class="tiny muted">{shift.startTime} – {shift.endTime} · {shift.durationHours} hours{#if shift.crossesMidnight} · crosses midnight{/if}</div>
              </div>
            </div>
          {/each}
        </div>
      </Card>
    </div>
  </div>
{/if}
