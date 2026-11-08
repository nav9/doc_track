<script lang="ts">
  import { Stethoscope } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import { navigate } from '../lib/app/router.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Select from '../lib/components/ui/Select.svelte';
  import { NAME_PREFIXES, USER_ROLES, emptyProfileDraft } from '../lib/domain/profile/profile';
  import type { EmploymentRecord } from '../lib/domain/profile/profile';
  import { titleCase } from '../lib/app/ui';

  let draft = $state(emptyProfileDraft());
  let customPrefix = $state('');
  let joiningDate = $state(app.today);
  let employmentType = $state<EmploymentRecord['employmentType']>('permanent');
  let error = $state('');

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
          These details label your records, roster and PDF. Nothing is uploaded anywhere.
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
          <Field label="Designation" bind:value={draft.designation} placeholder="e.g. Senior Resident" required />
          <Field label="Speciality" bind:value={draft.speciality} placeholder="e.g. Cardiology" />
          <Field label="Unit number" bind:value={draft.unit} placeholder="e.g. Unit II" />
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
        <div class="demo-disclaimer">
          <h2>Free demo software — no guarantees</h2>
          <p>
            DocTrack is a free demo. It may contain errors and comes with no guarantees.
          </p>
          <p>
            Always keep a written backup of your leave data in a notebook. If the browser cache
            is cleared, all leave data in this app can be lost unless you use the backup option
            to save a copy to disk periodically.
          </p>
          <p class="demo-disclaimer-strong">
            Do not rely on this app as the only record of your leave.
          </p>
        </div>
      </aside>
    </div>
  </div>
</div>
