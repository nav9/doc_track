<script lang="ts">
  import { AlertTriangle, Check, Download, Upload, X } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import { downloadText, pickTextFile } from '../lib/infrastructure/files/files';
  import { categoryChipClass, rangeText, statusTone } from '../lib/app/ui';
  import { leaveStatusLabel, type LeaveStatus } from '../lib/domain/leave/types';
  import type { ImportPreview } from '../lib/application/dto/version';
  import { messageOf } from '../lib/application/services/errors';

  let doctorFilter = $state('all');
  let statusFilter = $state('pending');
  let approvalNote = $state<Record<string, string>>({});
  let importText = $state('');
  let preview = $state<ImportPreview | null>(null);
  let importBusy = $state(false);

  const applications = $derived(
    app.snapshot.sharedLeaves
      .slice()
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.doctorName.localeCompare(b.doctorName))
  );
  const doctors = $derived(
    [...new Set(applications.map((leave) => leave.doctorName).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    )
  );
  const filtered = $derived(
    applications.filter((leave) => {
      if (doctorFilter !== 'all' && leave.doctorName !== doctorFilter) return false;
      if (statusFilter !== 'all' && leave.status !== statusFilter) return false;
      return true;
    })
  );
  const pendingCount = $derived(
    applications.filter((leave) => leave.status === 'pending' || leave.status === 'planned').length
  );

  async function decide(id: string, status: LeaveStatus) {
    await app.perform(
      (services) => services.setSharedLeaveStatus(id, status, approvalNote[id] ?? ''),
      status === 'approved'
        ? 'Leave approved. Export the approved list for the doctor.'
        : 'Leave marked as not approved.'
    );
  }

  async function exportApproved() {
    await app.perform(async (services) => {
      const { text, filename } = await services.exportText('multiuser', {
        approvedOnly: true,
        label: 'Approved leave applications'
      });
      downloadText(filename, text);
    }, 'Approved leaves exported. The doctor can import this file.');
  }

  async function loadImportFile() {
    const file = await pickTextFile();
    if (!file) return;
    importText = file.text;
    preview = null;
  }

  async function previewImportData() {
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

  async function applyImportData() {
    if (!preview) return;
    const current = preview;
    const result = await app.perform(
      (services) => services.applyImport(current),
      'Leave applications imported and ready for review.'
    );
    if (result) {
      preview = null;
      importText = '';
    }
  }
</script>

<PageHeader
  title="Leave approvals"
  subtitle="HR review of every leave application, with doctor filters and approved-list export."
>
  <Button variant="secondary" onclick={() => void exportApproved()}>
    <Download size={14} /> Export approved
  </Button>
</PageHeader>

{#if pendingCount > 0}
  <div class="banner banner-warning application-reminder">
    <AlertTriangle size={15} />
    <div>
      <strong>{pendingCount} application{pendingCount === 1 ? '' : 's'} awaiting a decision</strong>
      <div class="tiny">Doctors see a reminder until each application is approved or marked not approved.</div>
    </div>
  </div>
{/if}

<Card>
  <div class="section-card-head">
    <div>
      <h2>All submitted leaves</h2>
      <span class="tiny muted">Filter by doctor and by approval status.</span>
    </div>
    <Badge tone={pendingCount ? 'warning' : 'success'}>
      {pendingCount ? `${pendingCount} pending` : 'All reviewed'}
    </Badge>
  </div>
  <div class="form-grid">
    <label class="field">
      <span class="field-label">Doctor</span>
      <select class="input-base" bind:value={doctorFilter}>
        <option value="all">All doctors</option>
        {#each doctors as doctor (doctor)}
          <option value={doctor}>{doctor}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span class="field-label">Approval status</span>
      <select class="input-base" bind:value={statusFilter}>
        <option value="all">All statuses</option>
        <option value="planned">Planned</option>
        <option value="pending">Pending approval</option>
        <option value="approved">Approved</option>
        <option value="rejected">Not approved</option>
      </select>
    </label>
  </div>

  {#if filtered.length === 0}
    <div class="empty">
      <strong>No leave applications match this filter</strong>
      <span class="tiny muted">Import a doctor’s leave file or change the filters.</span>
    </div>
  {:else}
    <div class="stack-sm application-list">
      {#each filtered as leave (leave.id)}
        <div class="application-row application-row-{leave.status}">
          <div class="between" style="gap:8px;align-items:flex-start">
            <div>
              <div class="row" style="flex-wrap:wrap">
                <strong>{leave.doctorName}</strong>
                <span class="tiny muted">{leave.employeeId} · {leave.department}</span>
                <span class={categoryChipClass(leave.category)}>{leave.category}</span>
                <Badge tone={statusTone(leave.status)}>{leaveStatusLabel(leave.status)}</Badge>
              </div>
              <div class="small" style="margin-top:3px">
                {rangeText(leave.startDate, leave.endDate, app.settings?.dateFormat)}
              </div>
            </div>
            <div class="row">
              <Button size="sm" variant="success" onclick={() => void decide(leave.id, 'approved')}>
                <Check size={13} /> Approve
              </Button>
              <Button size="sm" variant="danger" onclick={() => void decide(leave.id, 'rejected')}>
                <X size={13} /> Not approved
              </Button>
            </div>
          </div>
          <div class="application-details">
            <div><strong>Purpose:</strong> {leave.purpose || leave.reason || '—'}</div>
            <div><strong>Covering:</strong> {leave.coveringDoctor || '—'}</div>
            {#if leave.notes}<div class="tiny muted">Notes: {leave.notes}</div>{/if}
            {#if leave.approvalNote}<div class="tiny muted">HR note: {leave.approvalNote}</div>{/if}
          </div>
          {#if leave.status === 'pending' || leave.status === 'planned'}
            <div class="tiny application-pending-note">Awaiting approval.</div>
          {/if}
          <Field label="HR note (optional)" bind:value={approvalNote[leave.id]} />
        </div>
      {/each}
    </div>
  {/if}
</Card>

<Card className="application-import-card">
  <div class="section-card-head">
    <div>
      <h2>Import leave applications</h2>
      <span class="tiny muted">Paste a doctor’s exported leave file to review all submitted leaves here.</span>
    </div>
    <Badge tone="neutral">Local only</Badge>
  </div>
  <Field label="Paste a DocTrack export" type="textarea" bind:value={importText} rows={4} placeholder="-----BEGIN DOCTRACK DATA-----…" />
  <div class="row" style="margin-top:7px">
    <Button size="sm" variant="secondary" onclick={loadImportFile}><Upload size={13} /> Choose file</Button>
    <Button size="sm" onclick={previewImportData} disabled={importBusy || !importText.trim()}>
      {importBusy ? 'Reading…' : 'Preview import'}
    </Button>
  </div>
  {#if preview}
    <div class="divider"></div>
    <div class="between">
      <strong>{preview.label}</strong>
      <Badge tone="info">{preview.kind}</Badge>
    </div>
    <p class="tiny muted" style="margin:4px 0">{preview.counts.sharedLeaves} leave record(s) in this file.</p>
    <div class="row">
      <Button size="sm" onclick={applyImportData} disabled={app.busy}>Apply import</Button>
      <Button size="sm" variant="ghost" onclick={() => (preview = null)}>Cancel</Button>
    </div>
  {/if}
</Card>
