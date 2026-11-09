<script lang="ts">
  import {
    ClipboardCopy,
    ClipboardPaste,
    Download,
    FileText,
    Plus,
    Sparkles,
    Trash2,
    Upload
  } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import Dialog from '../lib/components/ui/Dialog.svelte';
  import CalendarMonth from '../lib/components/CalendarMonth.svelte';
  import {
    downloadBlob,
    downloadText,
    pickTextFile,
    readClipboard,
    writeClipboard
  } from '../lib/infrastructure/files/files';
  import { formatDate } from '../lib/domain/common/dates';
  import type { ImportPreview } from '../lib/application/dto/version';
  import { messageOf } from '../lib/application/services/errors';
  import type { HolidayKind } from '../lib/domain/calendar/holidays';
  import { addMark, type DayMark } from '../lib/app/ui';
  import { levenshtein } from '../lib/engines/planning-engine/plannerTools';

  const FIXED_HOLIDAYS: { month: number; day: number; name: string; kind: HolidayKind }[] = [
    { month: 1, day: 26, name: 'Republic Day', kind: 'GH' },
    { month: 8, day: 15, name: 'Independence Day', kind: 'GH' },
    { month: 10, day: 2, name: 'Gandhi Jayanti', kind: 'GH' },
    { month: 12, day: 25, name: 'Christmas', kind: 'GH' }
  ];

  let year = $state(Number(app.today.slice(0, 4)));
  let name = $state('');
  let date = $state(app.today);
  let kind = $state<HolidayKind>('GH');
  let transferOpen = $state(false);
  let transferMode = $state<'export' | 'import'>('export');
  let transferText = $state('');
  let preview = $state<ImportPreview | null>(null);
  let transferBusy = $state(false);

  const holidays = $derived(
    app.snapshot.holidays
      .filter((holiday) => holiday.year === year)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
  );

  const marks = $derived.by(() => {
    const map: Record<string, DayMark[]> = {};
    for (const holiday of app.snapshot.holidays) {
      addMark(map, holiday.date, holiday.kind, holiday.kind === 'GH' ? 'gh' : 'rh');
    }
    return map;
  });

  const suggestions = $derived.by(() => {
    const query = name.trim().toLowerCase();
    const names = app.snapshot.holidayNames.map((item) => item.name);
    if (!query) {
      return [...new Map(app.snapshot.holidayNames
        .slice()
        .sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name))
        .map((item) => [item.name.toLowerCase(), item.name])).values()].slice(0, 6);
    }
    if (query.length < 2) return [];
    const threshold = Math.max(2, Math.ceil(query.length * 0.38));
    return [...new Set(names)]
      .map((item) => {
        const lower = item.toLowerCase();
        const words = lower.split(/\s+/).filter(Boolean);
        const score = lower.includes(query)
          ? 0
          : Math.min(
              levenshtein(query, lower),
              ...words.map((word) => levenshtein(query, word))
            );
        return { item, score };
      })
      .filter((entry) => entry.score <= threshold)
      .sort((a, b) => a.score - b.score || a.item.localeCompare(b.item))
      .slice(0, 6)
      .map((entry) => entry.item);
  });

  async function addHoliday() {
    if (!name.trim()) {
      app.notify('error', 'Enter the holiday name.');
      return;
    }
    const holidayName = name.trim();
    const saved = await app.perform(
      (services) =>
        services.saveHoliday({
          id: crypto.randomUUID(),
          year: Number(date.slice(0, 4)),
          date,
          name: holidayName,
          kind,
          notes: 'Added by HR'
        }),
      `${holidayName} added to the holiday list.`
    );
    if (saved !== null) name = '';
  }

  async function prefillFixedHolidays() {
    const existing = new Set(
      app.snapshot.holidays.map((holiday) => `${holiday.date}:${holiday.kind}`)
    );
    const additions = FIXED_HOLIDAYS.map((holiday) => {
      const holidayDate = `${year}-${String(holiday.month).padStart(2, '0')}-${String(
        holiday.day
      ).padStart(2, '0')}`;
      return { ...holiday, date: holidayDate };
    }).filter((holiday) => !existing.has(`${holiday.date}:${holiday.kind}`));

    if (additions.length === 0) {
      app.notify('info', `All fixed-date holidays for ${year} are already listed.`);
      return;
    }

    const names = await app.perform(
      async (services) => {
        for (const holiday of additions) {
          await services.saveHoliday({
            id: crypto.randomUUID(),
            year,
            date: holiday.date,
            name: holiday.name,
            kind: holiday.kind,
            notes: 'Prefilled fixed-date holiday'
          });
        }
        return additions.map((holiday) => holiday.name);
      },
      `${additions.length} fixed holiday${additions.length === 1 ? '' : 's'} added.`
    );
    if (names && names.length) {
      app.notify('info', `Added: ${names.join(', ')}.`);
    }
  }

  async function removeHoliday(id: string) {
    if (!window.confirm('Remove this holiday from the shared list?')) return;
    await app.perform((services) => services.deleteHoliday(id), 'Holiday removed.');
  }

  function useSuggestion(value: string) {
    name = value;
  }

  function openTransfer(mode: 'export' | 'import') {
    transferMode = mode;
    transferOpen = true;
    transferText = '';
    preview = null;
  }

  async function exportHolidays() {
    transferBusy = true;
    const result = await app.perform(async (services) => {
      const exported = await services.exportText('holidays', {
        year,
        label: `Holiday list ${year}`
      });
      return exported.text;
    });
    transferBusy = false;
    if (!result) return;
    transferText = result;
    transferMode = 'export';
    transferOpen = true;
  }

  async function copyExport() {
    if (!transferText) return;
    try {
      await writeClipboard(transferText);
      app.notify('success', 'Holiday list copied to the clipboard.');
    } catch (error) {
      app.notify('error', messageOf(error));
    }
  }

  async function browseImport() {
    const file = await pickTextFile();
    if (!file) return;
    transferText = file.text;
    await previewImport();
  }

  async function pasteImport() {
    transferBusy = true;
    try {
      const text = await readClipboard();
      transferText = text;
      await previewImport();
    } catch (error) {
      app.notify('error', messageOf(error));
    } finally {
      transferBusy = false;
    }
  }

  async function previewImport() {
    if (!app.services || !transferText.trim()) {
      app.notify('error', 'Paste a DocTrack holiday export first.');
      return;
    }
    transferBusy = true;
    preview = null;
    try {
      const result = await app.services.previewImport(transferText);
      if (result.kind !== 'holidays') {
        throw new Error('This data is not a holiday-list export.');
      }
      preview = result;
    } catch (error) {
      app.notify('error', messageOf(error));
    } finally {
      transferBusy = false;
    }
  }

  async function applyImportData() {
    if (!preview) return;
    const current = preview;
    const result = await app.perform(
      (services) => services.applyImport(current),
      'Holidays imported into the calendar.'
    );
    if (!result) return;
    transferOpen = false;
    preview = null;
    transferText = '';
  }

  const importedHolidays = $derived(
    preview?.snapshot.holidays.slice().sort((a, b) => a.date.localeCompare(b.date)) ?? []
  );

  const overwriteWarning = $derived.by(() => {
    if (!preview) return false;
    const existing = new Set(
      app.snapshot.holidays.map((holiday) => `${holiday.date}:${holiday.kind}`)
    );
    return preview.snapshot.holidays.some((holiday) =>
      existing.has(`${holiday.date}:${holiday.kind}`)
    );
  });

  function downloadExport() {
    if (transferText) downloadText(`DocTrack_Holidays_${year}.txt`, transferText);
  }

  async function createPdf() {
    if (!holidays.length) {
      app.notify('error', `Add at least one holiday for ${year} before creating a PDF.`);
      return;
    }
    const { generateHolidayPdf } = await import('../lib/infrastructure/pdf/holidayPdf');
    const blob = generateHolidayPdf(year, $state.snapshot(holidays));
    downloadBlob(`DocTrack_Holidays_${year}.pdf`, blob);
    app.notify('success', `Holiday list PDF for ${year} downloaded.`);
  }
</script>

<PageHeader title="Holiday calendar" subtitle="Here you can create and share or import the GH and RH holiday list">
  <Button variant="secondary" onclick={() => openTransfer('import')}>
    <Upload size={14} /> Import
  </Button>
  <Button variant="secondary" onclick={() => void exportHolidays()} disabled={transferBusy}>
    <Download size={14} /> Export {year}
  </Button>
  <Button variant="secondary" onclick={() => void createPdf()} disabled={holidays.length === 0}>
    <FileText size={14} /> Create PDF
  </Button>
</PageHeader>

<div class="holiday-layout">
  <Card>
    <div class="section-card-head">
      <div>
        <h2>Add a holiday</h2>
        <span class="tiny muted">Each holiday is immediately available to leave planning and NMC.</span>
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
      <label class="field">
        <span class="field-label">Holiday name</span>
        <input
          class="input-base"
          bind:value={name}
          list="holiday-name-options"
          placeholder="e.g. Republic Day"
          autocomplete="off"
        />
        <datalist id="holiday-name-options">
          {#each suggestions as suggestion (suggestion)}
            <option value={suggestion}></option>
          {/each}
        </datalist>
      </label>
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
    {#if suggestions.length}
      <div class="holiday-suggestions">
        {#each suggestions as suggestion (suggestion)}
          <button type="button" class="chip cat-gh holiday-suggestion" onclick={() => useSuggestion(suggestion)}>
            {suggestion}
          </button>
        {/each}
      </div>
    {/if}
    <div class="row" style="margin-top:8px">
      <Button onclick={addHoliday} disabled={app.busy}><Plus size={14} /> Add holiday</Button>
      <Button variant="secondary" onclick={() => void prefillFixedHolidays()} disabled={app.busy}>
        <Sparkles size={14} /> Prefill
      </Button>
    </div>
  </Card>

  <Card>
    <div class="section-card-head">
      <h2>{year} holiday list</h2>
      <Badge tone="neutral">{holidays.length} rows</Badge>
    </div>
    {#if holidays.length === 0}
      <div class="empty">
        <strong>No holidays for {year}</strong>
        <span class="tiny muted">Add rows on the left, use Prefill, or import a shared holiday list.</span>
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

<Card>
  <div class="section-card-head">
    <h2>{year} calendar</h2>
    <span class="tiny muted">General and restricted holidays appear on their dates</span>
  </div>
  <div class="holiday-year-scroll">
    {#each Array.from({ length: 12 }, (_, index) => index + 1) as calendarMonth (calendarMonth)}
      <div class="holiday-month">
        <CalendarMonth
          {year}
          month={calendarMonth}
          weekStartsOn={app.settings?.weekStartsOn ?? 1}
          {marks}
          hideHeader={false}
        />
      </div>
    {/each}
  </div>
</Card>

<Dialog
  open={transferOpen}
  title={transferMode === 'export' ? `Export holidays ${year}` : 'Import holiday list'}
  subtitle={transferMode === 'export'
    ? 'Review the holiday data before copying it.'
    : 'Browse a file or paste a DocTrack holiday export.'}
  onclose={() => (transferOpen = false)}
>
  {#if transferMode === 'export'}
    <div class="holiday-transfer-scroll">
      <table class="table-base">
        <thead><tr><th>Date</th><th>Holiday</th><th>Type</th></tr></thead>
        <tbody>
          {#each holidays as holiday (holiday.id)}
            <tr>
              <td>{formatDate(holiday.date, app.settings?.dateFormat)}</td>
              <td>{holiday.name}</td>
              <td>{holiday.kind}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="row" style="margin-top:10px">
      <Button variant="success" onclick={() => void copyExport()}>
        <ClipboardCopy size={14} /> Copy to clipboard
      </Button>
      <Button variant="secondary" onclick={downloadExport}>Download file</Button>
      <Button variant="ghost" onclick={() => (transferOpen = false)}>Close</Button>
    </div>
  {:else}
    <div class="row" style="margin-bottom:8px">
      <Button size="sm" variant="secondary" onclick={() => void browseImport()}>
        <Upload size={13} /> Browse
      </Button>
      <Button size="sm" variant="secondary" onclick={() => void pasteImport()} disabled={transferBusy}>
        <ClipboardPaste size={13} /> Paste from clipboard
      </Button>
    </div>
    {#if transferBusy}
      <p class="tiny muted">Reading holiday data…</p>
    {/if}
    {#if preview}
      {#if overwriteWarning}
        <div class="banner banner-warning" style="margin-bottom:8px">
          Some dates already exist in your holiday list. Existing rows are kept and duplicates are skipped.
        </div>
      {/if}
      <div class="holiday-transfer-scroll">
        <table class="table-base">
          <thead><tr><th>Date</th><th>Holiday</th><th>Type</th></tr></thead>
          <tbody>
            {#each importedHolidays as holiday (holiday.id)}
              <tr>
                <td>{formatDate(holiday.date, app.settings?.dateFormat)}</td>
                <td>{holiday.name}</td>
                <td>{holiday.kind}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="row" style="margin-top:10px">
        <Button variant="success" onclick={() => void applyImportData()} disabled={app.busy}>
          Use this data
        </Button>
        <Button variant="ghost" onclick={() => (preview = null)}>Cancel preview</Button>
      </div>
    {:else}
      <p class="tiny muted">The import will add new holidays and skip dates already present.</p>
    {/if}
  {/if}
</Dialog>
