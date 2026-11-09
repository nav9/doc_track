<script lang="ts">
  import { ClipboardPaste, Download, Plus, Trash2, Upload } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Select from '../lib/components/ui/Select.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import Dialog from '../lib/components/ui/Dialog.svelte';
  import {
    downloadText,
    pickTextFile,
    readClipboard
  } from '../lib/infrastructure/files/files';
  import { formatDate } from '../lib/domain/common/dates';
  import type { ImportPreview } from '../lib/application/dto/version';
  import { messageOf } from '../lib/application/services/errors';
  import type { CalendarEvent } from '../lib/domain/calendar/holidays';

  const typeOptions: { value: CalendarEvent['type']; label: string }[] = [
    { value: 'academic', label: 'Academic' },
    { value: 'exam', label: 'Examination' },
    { value: 'invigilation', label: 'Invigilation' },
    { value: 'meeting', label: 'Meeting' },
    { value: 'conference', label: 'Conference' },
    { value: 'personal', label: 'Personal' },
    { value: 'other', label: 'Other' }
  ];

  let title = $state('');
  let date = $state(app.today);
  let endDate = $state('');
  let type = $state<CalendarEvent['type']>('academic');
  let notes = $state('');
  let assignedTo = $state<string[]>([]);
  let importOpen = $state(false);
  let importText = $state('');
  let preview = $state<ImportPreview | null>(null);
  let importBusy = $state(false);

  const ownName = $derived(
    app.profile ? `${app.profile.prefix} ${app.profile.name}`.replace(/\s+/g, ' ').trim() : ''
  );
  const doctorOptions = $derived.by(() => {
    const values = new Set<string>();
    for (const doctor of app.snapshot.doctors) values.add(doctor.name);
    if (ownName) values.add(ownName);
    return [...values].sort((a, b) => a.localeCompare(b));
  });
  const events = $derived(
    app.snapshot.events
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
  );
  const importedEvents = $derived(
    preview?.snapshot.events
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)) ?? []
  );
  const overwriteWarning = $derived.by(() => {
    if (!preview) return false;
    const existing = new Set(app.snapshot.events.map((event) => event.id));
    return preview.snapshot.events.some((event) => existing.has(event.id));
  });

  function toggleDoctor(name: string) {
    assignedTo = assignedTo.includes(name)
      ? assignedTo.filter((item) => item !== name)
      : [...assignedTo, name];
  }

  async function saveEvent() {
    if (!title.trim()) {
      app.notify('error', 'Enter the event name.');
      return;
    }
    if (assignedTo.length === 0) {
      app.notify('error', 'Assign the event to at least one doctor.');
      return;
    }
    const saved = await app.perform(
      (services) =>
        services.saveEvent({
          title,
          date,
          endDate: endDate || null,
          type,
          allDay: true,
          startTime: null,
          endTime: null,
          notes,
          assignedTo
        }),
      'Event saved and assigned. Doctors can import it into their calendar.'
    );
    if (saved !== null) {
      title = '';
      endDate = '';
      notes = '';
      assignedTo = [];
    }
  }

  async function removeEvent(id: string) {
    if (!window.confirm('Remove this event?')) return;
    await app.perform((services) => services.deleteEvent(id), 'Event removed.');
  }

  async function exportEvents() {
    await app.perform(async (services) => {
      const { text, filename } = await services.exportText('events', {
        label: 'Academic and departmental events'
      });
      downloadText(filename, text);
    }, 'Events exported for doctors to import.');
  }

  function openImport() {
    importOpen = true;
    importText = '';
    preview = null;
  }

  async function browseImport() {
    const file = await pickTextFile();
    if (!file) return;
    importText = file.text;
    await previewImportData();
  }

  async function pasteImport() {
    importBusy = true;
    try {
      importText = await readClipboard();
      await previewImportData();
    } catch (error) {
      app.notify('error', messageOf(error));
    } finally {
      importBusy = false;
    }
  }

  async function previewImportData() {
    if (!app.services || !importText.trim()) {
      app.notify('error', 'Paste a DocTrack event export first.');
      return;
    }
    importBusy = true;
    app.lastError = null;
    preview = null;
    try {
      const result = await app.services.previewImport(importText);
      if (result.kind !== 'events') {
        throw new Error('This data is not an event-list export.');
      }
      if (result.snapshot.events.length === 0) {
        throw new Error('This export does not contain any events.');
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
      'Events imported and visible on the calendar.'
    );
    if (!result) return;
    importOpen = false;
    preview = null;
    importText = '';
  }
</script>

<PageHeader
  title="Academic events"
  subtitle="HR creates events, assigns them to doctors, and exports the list for import into calendars."
>
  <Button variant="secondary" onclick={openImport}>
    <Upload size={14} /> Import
  </Button>
  <Button variant="secondary" onclick={() => void exportEvents()}>
    <Download size={14} /> Export events
  </Button>
</PageHeader>

<div class="two-col">
  <Card>
    <div class="section-card-head">
      <div>
        <h2>Create an event</h2>
        <span class="tiny muted">SpCL planning and the doctor calendar use these assignments.</span>
      </div>
      <Badge tone="info">{events.length} event(s)</Badge>
    </div>
    <div class="form-grid">
      <Field label="Event name" bind:value={title} required placeholder="e.g. Annual academic conference" />
      <Select label="Type" bind:value={type} options={typeOptions} />
      <Field label="Start date" type="date" bind:value={date} required />
      <Field label="End date (optional)" type="date" bind:value={endDate} />
    </div>
    <Field label="Notes (optional)" type="textarea" bind:value={notes} rows={2} />
    <div class="field">
      <span class="field-label">Assign to doctors</span>
      <div class="assignment-grid">
        {#each doctorOptions as doctor (doctor)}
          <label class="assignment-option">
            <input
              type="checkbox"
              checked={assignedTo.includes(doctor)}
              onchange={() => toggleDoctor(doctor)}
            />
            {doctor}
          </label>
        {/each}
      </div>
    </div>
    <div class="row">
      <Button onclick={saveEvent} disabled={app.busy}><Plus size={14} /> Save event</Button>
      <span class="tiny muted">{assignedTo.length} doctor(s) selected.</span>
    </div>
  </Card>

  <Card>
    <div class="section-card-head">
      <h2>Event list</h2>
      <Badge tone="neutral">{events.length} rows</Badge>
    </div>
    {#if events.length === 0}
      <div class="empty">
        <strong>No events yet</strong>
        <span class="tiny muted">Create an event and assign it to one or more doctors.</span>
      </div>
    {:else}
      <div class="stack-sm">
        {#each events as event (event.id)}
          <div class="list-row" style="align-items:flex-start">
            <span class="chip cat-event">{event.type}</span>
            <div class="list-main">
              <div class="list-title">{event.title}</div>
              <div class="tiny muted">
                {formatDate(event.date, app.settings?.dateFormat)}
                {#if event.endDate} – {formatDate(event.endDate, app.settings?.dateFormat)}{/if}
              </div>
              <div class="tiny muted">
                Assigned: {event.assignedTo?.length ? event.assignedTo.join(', ') : 'Not assigned'}
              </div>
              {#if event.notes}<div class="tiny muted">{event.notes}</div>{/if}
            </div>
            <button
              type="button"
              class="icon-btn"
              aria-label={`Remove ${event.title}`}
              onclick={() => void removeEvent(event.id)}
            ><Trash2 size={14} /></button>
          </div>
        {/each}
      </div>
    {/if}
  </Card>
</div>

<Dialog
  open={importOpen}
  title="Import events"
  subtitle="Browse a file or paste a DocTrack event export to review it before importing."
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
    <p class="tiny muted">Reading event data…</p>
  {/if}
  {#if preview}
    {#if overwriteWarning}
      <div class="banner banner-warning" style="margin-bottom:8px">
        Some events already exist in this app. Existing events with matching records will be updated.
      </div>
    {/if}
    <div class="application-import-scroll">
      <table class="table-base">
        <thead><tr><th>Date</th><th>Event</th><th>Type</th><th>Assigned to</th></tr></thead>
        <tbody>
          {#each importedEvents as event (event.id)}
            <tr>
              <td>
                {formatDate(event.date, app.settings?.dateFormat)}
                {#if event.endDate} – {formatDate(event.endDate, app.settings?.dateFormat)}{/if}
              </td>
              <td>
                <strong>{event.title}</strong>
                {#if event.notes}<div class="tiny muted">{event.notes}</div>{/if}
              </td>
              <td><span class="chip cat-event">{event.type}</span></td>
              <td>{event.assignedTo?.length ? event.assignedTo.join(', ') : 'Not assigned'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="row" style="margin-top:10px">
      <Button variant="success" onclick={() => void applyImportData()} disabled={app.busy}>
        Apply import
      </Button>
      <Button variant="ghost" onclick={() => (preview = null)}>Cancel preview</Button>
    </div>
  {:else}
    <p class="tiny muted">Imported events appear on the assigned doctors’ calendars.</p>
  {/if}
</Dialog>
