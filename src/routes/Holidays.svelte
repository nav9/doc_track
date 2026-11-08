<script lang="ts">
  import { Copy, Download, Plus, Trash2, Upload } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import { downloadText, pickTextFile, writeClipboard } from '../lib/infrastructure/files/files';
  import { formatDate } from '../lib/domain/common/dates';
  import type { ImportPreview } from '../lib/application/dto/version';
  import { messageOf } from '../lib/application/services/errors';
  import type { HolidayKind } from '../lib/domain/calendar/holidays';

  let year = $state(Number(app.today.slice(0, 4)));
  let name = $state('');
  let date = $state(app.today);
  let kind = $state<HolidayKind>('GH');
  let importText = $state('');
  let preview = $state<ImportPreview | null>(null);
  let importBusy = $state(false);

  const holidays = $derived(
    app.snapshot.holidays
      .filter((holiday) => holiday.year === year)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
  );

  async function addHoliday() {
    if (!name.trim()) {
      app.notify('error', 'Enter the holiday name.');
      return;
    }
    const saved = await app.perform(
      (services) =>
        services.saveHoliday({
          id: crypto.randomUUID(),
          year: Number(date.slice(0, 4)),
          date,
          name,
          kind,
          notes: 'Added by HR'
        }),
      'Holiday saved. The leave calendar and ledger now use it.'
    );
    if (saved !== null) name = '';
  }

  async function removeHoliday(id: string) {
    if (!window.confirm('Remove this holiday from the shared list?')) return;
    await app.perform((services) => services.deleteHoliday(id), 'Holiday removed.');
  }

  async function exportHolidays(copy = false) {
    await app.perform(async (services) => {
      const { text, filename } = await services.exportText('holidays', {
        year,
        label: `Holiday list ${year}`
      });
      if (copy) {
        await writeClipboard(text);
        app.notify('success', 'Holiday list copied. Paste it into WhatsApp or another chat.');
      } else {
        downloadText(filename, text);
      }
    }, copy ? undefined : 'Holiday list downloaded.');
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
      'Holidays imported. They are available on the leave calendar immediately.'
    );
    if (result) {
      preview = null;
      importText = '';
    }
  }
</script>

<PageHeader
  title="Holiday calendar"
  subtitle="HR creates the GH and RH list for a year, then shares it by file or WhatsApp."
>
  <Button variant="secondary" onclick={() => void exportHolidays(false)}>
    <Download size={14} /> Export {year}
  </Button>
  <Button variant="secondary" onclick={() => void exportHolidays(true)}>
    <Copy size={14} /> Copy for WhatsApp
  </Button>
</PageHeader>

<div class="two-col">
  <Card>
    <div class="section-card-head">
      <div>
        <h2>Add a holiday</h2>
        <span class="tiny muted">Each row is immediately available to leave planning and NMC.</span>
      </div>
      <Badge tone="info">{holidays.length} listed</Badge>
    </div>
    <div class="form-grid">
      <label class="field">
        <span class="field-label">Year</span>
        <input
          class="input-base"
          type="number"
          min="2000"
          max="2100"
          value={year}
          onchange={(event) => {
            year = Number(event.currentTarget.value) || year;
            date = `${year}${date.slice(4)}`;
          }}
        />
      </label>
      <Field label="Holiday name" bind:value={name} required placeholder="e.g. Republic Day" />
      <Field
        label="Date"
        type="date"
        bind:value={date}
        required
        onchange={(event) => {
          date = event.currentTarget.value;
          year = Number(date.slice(0, 4)) || year;
        }}
      />
      <label class="field">
        <span class="field-label">Type</span>
        <select class="input-base" bind:value={kind}>
          <option value="GH">GH — General Holiday</option>
          <option value="RH">RH — Restricted Holiday</option>
        </select>
      </label>
    </div>
    <Button onclick={addHoliday} disabled={app.busy}><Plus size={14} /> Add holiday</Button>
  </Card>

  <Card>
    <div class="section-card-head">
      <h2>{year} holiday list</h2>
      <Badge tone="neutral">{holidays.length} rows</Badge>
    </div>
    {#if holidays.length === 0}
      <div class="empty">
        <strong>No holidays for {year}</strong>
        <span class="tiny muted">Add rows on the left or import a shared holiday list.</span>
      </div>
    {:else}
      <div class="table-wrap">
        <table class="table-base">
          <thead><tr><th>Date</th><th>Holiday</th><th>Type</th><th></th></tr></thead>
          <tbody>
            {#each holidays as holiday (holiday.id)}
              <tr>
                <td>{formatDate(holiday.date, app.settings?.dateFormat)}</td>
                <td><strong>{holiday.name}</strong></td>
                <td><span class="chip cat-{holiday.kind === 'GH' ? 'gh' : 'rh'}">{holiday.kind}</span></td>
                <td>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`Remove ${holiday.name}`}
                    onclick={() => void removeHoliday(holiday.id)}
                  ><Trash2 size={14} /></button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </Card>
</div>

<Card className="application-import-card">
  <div class="section-card-head">
    <div>
      <h2>Import holiday list</h2>
      <span class="tiny muted">Paste a DocTrack holiday export received through WhatsApp or a file.</span>
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
    <p class="tiny muted" style="margin:4px 0">{preview.counts.holidays} holiday(s) in this file.</p>
    <div class="row">
      <Button size="sm" onclick={applyImportData} disabled={app.busy}>Apply import</Button>
      <Button size="sm" variant="ghost" onclick={() => (preview = null)}>Cancel</Button>
    </div>
  {/if}
</Card>
