<script lang="ts">
  import { AlertTriangle, Check, ClipboardPaste, Download, Upload, X } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import Dialog from '../lib/components/ui/Dialog.svelte';
  import {
    downloadText,
    pickTextFile,
    readClipboard
  } from '../lib/infrastructure/files/files';
  import { categoryChipClass, rangeText, statusTone } from '../lib/app/ui';
  import { leaveStatusLabel, type LeaveStatus } from '../lib/domain/leave/types';
  import type { ImportPreview } from '../lib/application/dto/version';
  import { messageOf } from '../lib/application/services/errors';

  let doctorFilter = $state('all');
  let statusFilter = $state('all');
  let approvalNote = $state<Record<string, string>>({});
  let selectedIds = $state<string[]>([]);
  let importOpen = $state(false);
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
  const allFilteredSelected = $derived(
    filtered.length > 0 && filtered.every((leave) => selectedIds.includes(leave.id))
  );
  const importedLeaves = $derived(
    preview?.snapshot.sharedLeaves
      .slice()
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.doctorName.localeCompare(b.doctorName)) ?? []
  );
  const overwriteWarning = $derived.by(() => {
    if (!preview) return false;
    const existing = new Set(app.snapshot.sharedLeaves.map((leave) => leave.id));
    return preview.snapshot.sharedLeaves.some((leave) => existing.has(leave.id));
  });

  function toggleSelected(id: string, checked: boolean) {
    selectedIds = checked
      ? [...new Set([...selectedIds, id])]
      : selectedIds.filter((selected) => selected !== id);
  }

  function setApprovalNote(id: string, value: string) {
    approvalNote = { ...approvalNote, [id]: value };
  }

  function toggleAll() {
    if (allFilteredSelected) {
      selectedIds = [];
      return;
    }
    selectedIds = [...new Set([...selectedIds, ...filtered.map((leave) => leave.id)])];
  }

  async function decide(id: string, status: LeaveStatus) {
    await app.perform(
      (services) => services.setSharedLeaveStatus(id, status, approvalNote[id] ?? ''),
      status === 'approved'
        ? 'Leave approved. Select it for export when needed.'
        : 'Leave marked as not approved.'
    );
  }

  async function exportSelected() {
    if (!selectedIds.length) {
      app.notify('error', 'Select at least one leave row to export.');
      return;
    }
    const ids = [...selectedIds];
    await app.perform(async (services) => {
      const { text, filename } = await services.exportText('multiuser', {
        sharedLeaveIds: ids,
        label: 'Selected leave applications'
      });
      downloadText(filename, text);
    }, `${ids.length} selected leave application${ids.length === 1 ? '' : 's'} exported.`);
  }

  function openImport() {
    importOpen = true;
    importText = '';
    preview = null;
    importBusy = false;
  }

  async function pasteImport() {
    importBusy = true;
    try {
      const text = await readClipboard();
      await previewImportData(text);
    } catch (error) {
      app.notify('error', messageOf(error));
    } finally {
      importBusy = false;
    }
  }

  async function browseImport() {
    const file = await pickTextFile();
    if (!file) return;
    await previewImportData(file.text);
  }

  async function previewImportData(text: string) {
    if (!app.services) return;
    if (!text.trim()) {
      app.notify('error', 'Choose a leave file or copy one to the clipboard first.');
      return;
    }
    importBusy = true;
    preview = null;
    importText = text;
    try {
      const result = await app.services.previewImport(text);
      if (result.kind !== 'multiuser') {
        throw new Error('This data is not a leave-application export.');
      }
      preview = result;
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
    if (!result) return;
    importOpen = false;
    preview = null;
    importText = '';
    selectedIds = [];
    doctorFilter = 'all';
    statusFilter = 'all';
  }
</script>

<PageHeader
  title="Leave approvals"
  subtitle="HR review of every leave application, with doctor filters and selected-list export."
>
  <Button variant="secondary" onclick={openImport}>
    <Upload size={14} /> Import
  </Button>
  <Button
    variant="secondary"
    onclick={() => void exportSelected()}
    disabled={!selectedIds.length || app.busy}
  >
    <Download size={14} /> Export
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
      <span class="tiny muted">Filter by doctor and approval status, then select rows to export.</span>
    </div>
    <div class="row">
      <Badge tone={pendingCount ? 'warning' : 'success'}>
        {pendingCount ? `${pendingCount} pending` : 'All reviewed'}
      </Badge>
      <Button
        size="sm"
        variant="secondary"
        onclick={toggleAll}
        disabled={filtered.length === 0}
      >
        {allFilteredSelected ? 'Select none' : 'Select all'}
      </Button>
    </div>
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
          <div class="application-row-head">
            <input
              type="checkbox"
              class="application-select"
              aria-label={`Select ${leave.doctorName} ${leave.category} leave from ${leave.startDate}`}
              checked={selectedIds.includes(leave.id)}
              onchange={(event) => toggleSelected(leave.id, event.currentTarget.checked)}
            />
            <div class="grow">
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
          <Field
            label="HR note (optional)"
            value={approvalNote[leave.id] ?? ''}
            onchange={(event) => setApprovalNote(leave.id, event.currentTarget.value)}
          />
        </div>
      {/each}
    </div>
  {/if}
</Card>

<Dialog
  open={importOpen}
  title="Import leave applications"
  subtitle="Browse a DocTrack leave file or paste one from the clipboard."
  onclose={() => (importOpen = false)}
>
  <div class="row" style="margin-bottom:8px">
    <Button size="sm" variant="secondary" onclick={() => void browseImport()}>
      <Upload size={13} /> Browse
    </Button>
    <Button
      size="sm"
      variant="secondary"
      onclick={() => void pasteImport()}
      disabled={importBusy}
    >
      <ClipboardPaste size={13} /> Paste from clipboard
    </Button>
  </div>

  {#if importBusy}
    <p class="tiny muted">Reading leave data…</p>
  {/if}

  {#if preview}
    <div class="between">
      <strong>{preview.label}</strong>
      <Badge tone="info">{importedLeaves.length} leave{importedLeaves.length === 1 ? '' : 's'}</Badge>
    </div>
    {#if overwriteWarning}
      <div class="banner banner-warning" style="margin:8px 0">
        Some leave records are already in this app. Applying the import will update those records.
      </div>
    {/if}
    <div class="application-import-scroll">
      <table class="table-base">
        <thead>
          <tr>
            <th>Doctor</th>
            <th>Leave dates</th>
            <th>Type</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {#each importedLeaves as leave (leave.id)}
            <tr>
              <td>
                <strong>{leave.doctorName || '—'}</strong>
                <div class="tiny muted">{leave.employeeId || 'No employee ID'} · {leave.department || 'No department'}</div>
              </td>
              <td>{rangeText(leave.startDate, leave.endDate, app.settings?.dateFormat)}</td>
              <td><span class={categoryChipClass(leave.category)}>{leave.category}</span></td>
              <td><Badge tone={statusTone(leave.status)}>{leaveStatusLabel(leave.status)}</Badge></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="row" style="margin-top:10px">
      <Button variant="success" onclick={() => void applyImportData()} disabled={app.busy}>
        Proceed
      </Button>
      <Button variant="ghost" onclick={() => (preview = null)}>Cancel preview</Button>
    </div>
  {:else}
    <p class="tiny muted">
      Choose a file exported from DocTrack, or copy the exported text to the clipboard and paste it here.
      You can review every leave before applying it.
    </p>
  {/if}
</Dialog>
