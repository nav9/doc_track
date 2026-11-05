<script lang="ts">
  import { Stethoscope } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import { navigate } from '../lib/app/router.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Select from '../lib/components/ui/Select.svelte';
  import { NAME_PREFIXES, USER_ROLES, emptyProfileDraft } from '../lib/domain/profile/profile';
  import type { EmploymentRecord } from '../lib/domain/profile/profile';
  import { titleCase, daysText } from '../lib/app/ui';

  let draft = $state(emptyProfileDraft());
  let customPrefix = $state('');
  let joiningDate = $state(app.today);
  let employmentType = $state<EmploymentRecord['employmentType']>('permanent');
  let error = $state('');

  const policy = $derived(app.activePolicy);
  const prefixOptions = NAME_PREFIXES.map((prefix) => ({ value: prefix, label: prefix }));
  const roleOptions = USER_ROLES.map((role) => ({
    value: role,
    label: role === 'hod' ? 'Head of department' : titleCase(role)
  }));
  const employmentTypeOptions = [
    { value: 'permanent', label: 'Permanent' },
    { value: 'temporary', label: 'Temporary' },
    { value: 'contract', label: 'Contract' },
    { value: 'visiting', label: 'Visiting' }
  ];
  const categorySummary = $derived(
    (policy?.categories ?? [])
      .filter((category) => category.enabled && ['CL', 'EL', 'CCL', 'SPCL', 'RH'].includes(category.code))
      .map((category) => ({
        code: category.code,
        name: category.fullForm,
        detail:
          category.code === 'CCL'
            ? `Earned from holiday/weekend duty; each credit is valid ${category.expiry?.months ?? 3} calendar months.`
            : category.code === 'RH'
              ? 'One restricted holiday for each six-month period counted from the joining date.'
              : `${daysText(category.entitlement.usageCap ?? category.entitlement.amount ?? 0)} per ${category.entitlement.period.replace('-', ' ')}${
                  category.maxDaysPerMonth ? `, at most ${category.maxDaysPerMonth} per month` : ''
                }.`
      }))
  );

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    const resolvedPrefix = draft.prefix === 'Other' ? customPrefix.trim() : draft.prefix;
    if (draft.prefix === 'Other' && !resolvedPrefix) {
      error = 'Enter the prefix you use (for example “Lt. Col.”).';
      return;
    }
    if (!draft.hospitalName?.trim()) {
      error = 'Enter the medical college or hospital name.';
      return;
    }
    const saved = await app.perform(
      (services) =>
        services.saveProfile(draft, {
          resolvedPrefix,
          joiningDate,
          employmentType,
          organisationName: draft.hospitalName?.trim() ?? ''
        }),
      'Profile created. Your data stays on this device.'
    );
    if (saved) navigate('/');
  }
</script>

<div class="onboarding">
  <div class="onboarding-inner">
    <header class="onboarding-head">
      <span class="brand-mark"><Stethoscope size={19} /></span>
      <div>
        <div class="brand-name" style="color:var(--text)">DocTrack</div>
        <div class="muted tiny">Leave planning, duty roster and NMC attendance for doctors</div>
      </div>
    </header>

    <div class="onboarding-grid">
      <form class="card card-pad" onsubmit={submit}>
        <h1 style="font-size:1.2rem">Set up your profile</h1>
        <p class="muted small" style="margin:4px 0 14px">
          These details label your records, roster and PDF. Only the first four fields are
          compulsory. Nothing is uploaded anywhere.
        </p>

        {#if error}
          <div class="banner banner-danger" style="margin-bottom:10px">{error}</div>
        {/if}
        {#if app.lastError}
          <div class="banner banner-danger" style="margin-bottom:10px">
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

        <div class="form-grid">
          <Select label="Prefix" bind:value={draft.prefix} options={prefixOptions} required />
          {#if draft.prefix === 'Other'}
            <Field
              label="Custom prefix"
              bind:value={customPrefix}
              placeholder="e.g. Lt. Col."
              required
            />
          {/if}
          <Field label="Full name" bind:value={draft.name} placeholder="As on the duty roster" required />
          <Field label="Employee ID" bind:value={draft.employeeId} placeholder="College / hospital ID" required />
          <Field label="Department" bind:value={draft.department} placeholder="e.g. General Medicine" required />
          <Field label="Designation" bind:value={draft.designation} placeholder="e.g. Senior Resident" />
          <Field label="Speciality" bind:value={draft.speciality} placeholder="e.g. Cardiology" />
          <Field label="Unit / ward" bind:value={draft.unit} placeholder="e.g. Unit II" />
          <Field
            label="Medical college / hospital"
            bind:value={draft.hospitalName}
            placeholder="Institution name"
            required
          />
          <Select label="Role" bind:value={draft.role} options={roleOptions} />
          <Field label="Joining date" type="date" bind:value={joiningDate} required hint="Used to prorate the joining year and count RH periods." />
          <Select label="Employment type" bind:value={employmentType} options={employmentTypeOptions} />
          <Field label="Email (optional)" type="email" bind:value={draft.contactEmail} />
          <Field label="Phone (optional)" type="tel" bind:value={draft.contactPhone} />
        </div>

        <Field
          label="Notes (optional)"
          type="textarea"
          bind:value={draft.notes}
          rows={2}
          hint="Anything you want on your own record. Not printed on the roster."
        />

        <div class="row" style="margin-top:10px">
          <Button type="submit" disabled={app.busy}>
            {app.busy ? 'Saving…' : 'Create profile'}
          </Button>
          <span class="tiny muted">No account, no sign-in, no internet needed.</span>
        </div>
      </form>

      <aside class="stack">
        <div class="card card-pad">
          <h2 style="font-size:0.95rem">What DocTrack will apply</h2>
          <p class="muted tiny" style="margin:3px 0 10px">
            {policy?.name ?? 'Medical college policy'} · version {policy?.version ?? 1}. Every
            number is editable later in the Policy Studio.
          </p>
          <div class="stack-sm">
            {#each categorySummary as item (item.code)}
              <div class="list-row">
                <span class="chip cat-{item.code.toLowerCase()}">{item.code}</span>
                <div class="list-main">
                  <div class="list-title">{item.name}</div>
                  <div class="tiny muted">{item.detail}</div>
                </div>
              </div>
            {/each}
            <div class="list-row">
              <span class="chip cat-nmc">NMC</span>
              <div class="list-main">
                <div class="list-title">21 punches per month</div>
                <div class="tiny muted">
                  Sundays and listed holidays are excluded; missing punches can be covered by a
                  Sunday punch.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="banner banner-info">
          <div>
            <strong>Your data lives in this browser</strong>
            <p class="tiny muted" style="margin:3px 0 0">
              Clearing browser data or the app cache deletes DocTrack records. Export a backup
              from Settings and keep the file outside the browser.
            </p>
          </div>
        </div>
      </aside>
    </div>
  </div>
</div>
