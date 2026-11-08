<script lang="ts">
  import { Download, Plus, Trash2, Upload } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Select from '../lib/components/ui/Select.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import { downloadText, pickTextFile } from '../lib/infrastructure/files/files';
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
      'Events imported and visible on the calendar.'
    );
    if (result) {
      preview = null;
      importText = '';
    }
  }
</script>

<PageHeader
  title="Academic events"
  subtitle="HR creates events, assigns them to doctors, and exports the list for import into calendars."
>
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

<Card className="application-import-card">
  <div class="section-card-head">
    <div>
      <h2>Import events</h2>
      <span class="tiny muted">Paste a DocTrack event export. Imported events appear on assigned doctors’ calendars.</span>
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
    <p class="tiny muted" style="margin:4px 0">{preview.counts.events} event(s) in this file.</p>
    <div class="row">
      <Button size="sm" onclick={applyImportData} disabled={app.busy}>Apply import</Button>
      <Button size="sm" variant="ghost" onclick={() => (preview = null)}>Cancel</Button>
    </div>
  {/if}
</Card>
