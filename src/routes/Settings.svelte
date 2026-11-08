<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Select from '../lib/components/ui/Select.svelte';
  import Toggle from '../lib/components/ui/Toggle.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import { DATE_FORMATS, formatDateTime } from '../lib/domain/common/dates';
  import type { AppSettings, LogLevel } from '../lib/domain/settings/types';
  import { LOG_LEVELS } from '../lib/domain/settings/types';
  import type { ExportKind, ImportPreview } from '../lib/application/dto/version';
  import { downloadText, pickDirectory, pickTextFile, writeFileToDirectory } from '../lib/infrastructure/files/files';
  import type { DirectoryHandleLike } from '../lib/infrastructure/files/files';
  import { bytesText, numberFrom } from '../lib/app/ui';
  import { messageOf } from '../lib/application/services/errors';

  let draft = $state<AppSettings | null>(null);
  let backupFolderName = $state('');
  let importText = $state('');
  let preview = $state<ImportPreview | null>(null);
  let importBusy = $state(false);
  let exportKind = $state<ExportKind>('full');

  $effect(() => {
    if (app.settings && draft === null) draft = $state.snapshot(app.settings);
  });

  onMount(async () => {
    if (!app.services) return;
    const handle = await app.services.metaGet<DirectoryHandleLike>('backupDirectory');
    backupFolderName = handle?.name ?? '';
  });

  async function saveSettings() {
    if (!draft) return;
    const current = $state.snapshot(draft);
    const saved = await app.perform((services) => services.saveSettings(current), 'Settings saved.');
    if (saved) draft = $state.snapshot(saved);
  }

  async function exportData() {
    const kind = exportKind;
    await app.perform(async (services) => {
      const { text, filename } = await services.exportText(kind);
      downloadText(filename, text);
    }, 'Export downloaded.');
  }

  async function previewImport() {
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

  async function applyImport() {
    if (!preview) return;
    const current = preview;
    const result = await app.perform(
      (services) => services.applyImport(current),
      'Import complete. The previous state was saved in version history.'
    );
    if (result) {
      preview = null;
      importText = '';
    }
  }

  async function loadFile() {
    const file = await pickTextFile();
    if (!file) return;
    importText = file.text;
    preview = null;
  }

  async function chooseFolder() {
    if (!app.services) return;
    const handle = await pickDirectory();
    if (!handle) {
      app.notify('info', 'Folder selection is unavailable in this browser, or it was cancelled. Use the download instead.');
      return;
    }
    await app.services.metaSet('backupDirectory', handle);
    backupFolderName = handle.name;
    app.notify('success', `Backup folder set to “${handle.name}”.`);
  }

  async function backupToFolder() {
    if (!app.services) return;
    const handle = await app.services.metaGet<DirectoryHandleLike>('backupDirectory');
    if (!handle) {
      app.notify('info', 'Choose a backup folder first.');
      return;
    }
    await app.perform(async (services) => {
      const { text, filename } = await services.exportText('full');
      await writeFileToDirectory(handle, filename, text);
      await services.recordManualBackup();
    }, 'Backup written to the chosen folder.');
  }

  async function clearLogs() {
    if (!window.confirm('Clear all activity logs? Logs are diagnostic only; leave and duty records are not affected.')) return;
    await app.perform((services) => services.clearLogs(), 'Logs cleared.');
  }

  function levelOptions() {
    return LOG_LEVELS.map((level) => ({ level }));
  }
</script>

<PageHeader
  title="Settings"
  subtitle="Appearance, backups, imports, version history and developer options."
>
  <Button onclick={saveSettings} disabled={app.busy || !draft}>Save settings</Button>
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

{#if draft}
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;align-items:start">
    <div class="stack">
      <Card>
        <div class="section-card-head"><h2>Appearance</h2></div>
        <div class="form-grid">
          <Select
            label="Theme"
            bind:value={draft.theme}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'Follow the device' }
            ]}
          />
          <Select
            label="Calendar density"
            bind:value={draft.calendarDensity}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Comfortable' }
            ]}
          />
          <Select
            label="Week starts on"
            value={String(draft.weekStartsOn)}
            onchange={(event) => {
              if (draft) draft.weekStartsOn = Number(event.currentTarget.value) === 0 ? 0 : 1;
            }}
            options={[
              { value: '1', label: 'Monday' },
              { value: '0', label: 'Sunday' }
            ]}
          />
          <Select
            label="Date format"
            bind:value={draft.dateFormat}
            options={DATE_FORMATS.map((format) => ({ value: format, label: format }))}
          />
          <Select
            label="Time format"
            bind:value={draft.timeFormat}
            options={[
              { value: '24h', label: '24-hour' },
              { value: '12h', label: '12-hour' }
            ]}
          />
          <Select
            label="Roster date format"
            bind:value={draft.rosterDateFormat}
            options={DATE_FORMATS.map((format) => ({ value: format, label: format }))}
          />
        </div>
        <Toggle
          bind:checked={draft.colorblind}
          label="Colourblind-friendly category colours"
          hint="Also keeps text labels on every chip, so colour is never the only signal."
        />
        <Toggle
          bind:checked={draft.greetingDismissed}
          label="Hide the greeting on the dashboard"
          hint="The dashboard title becomes a plain “Dashboard”."
        />
        <Toggle
          bind:checked={draft.dutyRosterEnabled}
          label="Enable the duty roster section"
          hint="The roster and PDF remain available; turn this off only if your department does not use them."
        />
      </Card>

      <Card>
        <div class="section-card-head">
          <h2>Backup</h2>
          <Badge tone={draft.lastBackupAt ? 'success' : 'warning'}>
            {draft.lastBackupAt ? `Last ${formatDateTime(draft.lastBackupAt)}` : 'Never backed up'}
          </Badge>
        </div>
        <Toggle bind:checked={draft.backupReminderEnabled} label="Remind me to back up" />
        <Field
          label="Reminder after (days)"
          value={String(draft.backupReminderDays)}
          oninput={(event) => { if (draft) draft.backupReminderDays = Math.max(1, Math.round(numberFrom(event.currentTarget.value, 14))); }}
        />
        <div class="row">
          <Button size="sm" variant="secondary" onclick={() => void app.backupNow()}>Download full backup</Button>
        </div>
        <div class="divider"></div>
        <Toggle
          bind:checked={draft.autoBackupEnabled}
          label="Automatic backup to a folder"
          hint="Uses the browser’s File System Access API. Manual download always works."
        />
        <Field
          label="Automatic backup frequency (days)"
          value={String(draft.autoBackupFrequencyDays)}
          oninput={(event) => { if (draft) draft.autoBackupFrequencyDays = Math.max(1, Math.round(numberFrom(event.currentTarget.value, 7))); }}
        />
        <div class="row">
          <Button size="sm" variant="secondary" onclick={chooseFolder}>Choose folder</Button>
          <Button size="sm" variant="subtle" onclick={backupToFolder} disabled={!backupFolderName}>Back up to folder</Button>
        </div>
        <p class="tiny muted" style="margin:5px 0 0">
          {backupFolderName ? `Folder: ${backupFolderName}` : 'No backup folder selected.'}
        </p>
        <div class="banner banner-warning" style="margin-top:9px">
          Browser storage can be cleared by the browser or the operating system. Keep a backup
          outside the browser.
        </div>
      </Card>

      <Card>
        <div class="section-card-head"><h2>Version history</h2></div>
        <Toggle
          bind:checked={draft.versioningEnabled}
          label="Keep snapshots before imports and rollbacks"
          hint="Full snapshots are small for personal data and make restoration exact."
        />
        <Field
          label="Snapshots retained"
          value={String(draft.versionRetention)}
          oninput={(event) => { if (draft) draft.versionRetention = Math.max(1, Math.round(numberFrom(event.currentTarget.value, 20))); }}
          hint="The oldest snapshots are pruned when this limit is exceeded."
        />
        <div class="row">
          <a class="btn btn-secondary btn-sm" href="#/versions">Open version history</a>
        </div>
        <div class="divider"></div>
        <Toggle bind:checked={draft.showEngineLab} label="Show the policy test lab" hint="Adds a simulation panel inside Policy Studio. No effect on rules." />
      </Card>
    </div>

    <div class="stack">
      <Card>
        <div class="section-card-head">
          <h2>Import data</h2>
          <Badge tone="neutral">Reversible</Badge>
        </div>
        <Field label="Paste an exported block" type="textarea" bind:value={importText} rows={5} placeholder="-----BEGIN DOCTRACK DATA-----…" />
        <div class="row">
          <Button size="sm" variant="secondary" onclick={loadFile}>Choose a file</Button>
          <Button size="sm" onclick={previewImport} disabled={importBusy || !importText.trim()}>
            {importBusy ? 'Reading…' : 'Preview import'}
          </Button>
        </div>
        <p class="tiny muted" style="margin:5px 0 0">
          A version snapshot is taken before anything is written. Published policy versions are
          never overwritten; imported policies arrive as drafts.
        </p>
        {#if preview}
          <div class="divider"></div>
          <div class="between">
            <strong class="small">{preview.label}</strong>
            <Badge tone="info">{preview.kind}</Badge>
          </div>
          <dl class="detail-grid" style="margin-top:6px">
            <div><dt>Leave records</dt><dd>{preview.counts.leaveRequests}</dd></div>
            <div><dt>Ledger entries</dt><dd>{preview.counts.ledgerEntries}</dd></div>
            <div><dt>Duties</dt><dd>{preview.counts.duties}</dd></div>
            <div><dt>Holidays</dt><dd>{preview.counts.holidays}</dd></div>
            <div><dt>Rosters</dt><dd>{preview.counts.rosterMonths}</dd></div>
            <div><dt>Shared leave</dt><dd>{preview.counts.sharedLeaves}</dd></div>
            <div><dt>Policies</dt><dd>{preview.counts.policyVersions}</dd></div>
          </dl>
          {#if preview.lines.length > 0}
            <ul class="reasons">
              {#each preview.lines as line}
                <li class="reason reason-info"><strong>{line.label}:</strong> {line.detail}</li>
              {/each}
            </ul>
          {/if}
          {#if preview.invalidCount > 0}
            <div class="banner banner-warning" style="margin-top:7px">
              {preview.invalidCount} record(s) were not readable and will be skipped.
            </div>
          {/if}
          {#if preview.conflicts.length > 0}
            <div class="banner banner-warning" style="margin-top:7px">
              {preview.conflicts.length} duplicate record(s) will be skipped or merged.
            </div>
          {/if}
          <div class="row" style="margin-top:8px">
            <Button size="sm" onclick={applyImport} disabled={app.busy}>Apply import</Button>
            <Button size="sm" variant="ghost" onclick={() => (preview = null)}>Cancel</Button>
          </div>
        {/if}
      </Card>

      <Card>
        <div class="section-card-head"><h2>Export data</h2></div>
        <Select
          label="What to export"
          bind:value={exportKind}
          options={[
            { value: 'full', label: 'Complete backup (everything)' },
            { value: 'leave', label: 'Leave history and ledger' },
            { value: 'policy', label: 'Policy package' },
            { value: 'holidays', label: 'Holiday list' },
            { value: 'roster', label: 'Duty rosters' },
            { value: 'multiuser', label: 'Multi User doctors and shared leave' },
            { value: 'events', label: 'Academic and departmental events' }
          ]}
        />
        <div class="row" style="margin-top:6px">
          <Button size="sm" variant="secondary" onclick={exportData}>Download export</Button>
        </div>
        <p class="tiny muted" style="margin:6px 0 0">
          Exports are plain text with BEGIN/END markers. A whole WhatsApp message can be pasted
          back into the import box; DocTrack extracts only the marked block.
        </p>
      </Card>

      <Card>
        <div class="section-card-head">
          <h2>Logs and clock</h2>
          <Badge tone={app.isSimulated ? 'warning' : 'neutral'}>{app.isSimulated ? 'Simulated time' : 'Device time'}</Badge>
        </div>
        <Field
          label="Keep logs for (days)"
          value={String(draft.logRetentionDays)}
          oninput={(event) => { if (draft) draft.logRetentionDays = Math.max(1, Math.round(numberFrom(event.currentTarget.value, 30))); }}
        />
        <div class="stack-sm">
          {#each levelOptions() as item (item.level)}
            <Toggle
              bind:checked={draft.logLevels[item.level]}
              label={`Record ${item.level} logs`}
            />
          {/each}
        </div>
        <div class="row">
          <a class="btn btn-secondary btn-sm" href="#/logs">Open logs</a>
          <Button size="sm" variant="ghost" onclick={clearLogs}>Clear logs</Button>
        </div>
        <div class="divider"></div>
        <Toggle
          bind:checked={draft.manualNowEnabled}
          label="Simulate a date and time"
          hint="Useful for testing policy periods. The app shows a warning badge wherever the simulated clock is active."
        />
        <label class="field">
          <span class="field-label">Simulated now</span>
          <span class="date-input-shell">
            <input
              class="input-base date-input-native"
              type="datetime-local"
              value={draft.manualNow ? draft.manualNow.slice(0, 16) : ''}
              oninput={(event) => {
                if (!draft) return;
                draft.manualNow = event.currentTarget.value
                  ? new Date(event.currentTarget.value).toISOString()
                  : null;
              }}
            />
            <span class="date-input-value" class:is-empty={!draft.manualNow} aria-hidden="true">
              {draft.manualNow ? formatDateTime(draft.manualNow) : 'Select date and time'}
            </span>
          </span>
        </label>
        {#if app.storage}
          <p class="tiny muted" style="margin:6px 0 0">
            Local storage used: {bytesText(app.storage.usage)} of {bytesText(app.storage.quota)}.
          </p>
        {/if}
      </Card>
    </div>
  </div>
{/if}
