<script lang="ts">
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Field from '../lib/components/ui/Field.svelte';
  import Select from '../lib/components/ui/Select.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import EmptyState from '../lib/components/ui/EmptyState.svelte';
  import type { LogEntry, LogLevel } from '../lib/domain/settings/types';
  import { formatDateTime } from '../lib/domain/common/dates';

  let logs = $state<LogEntry[]>([]);
  let level = $state<'ALL' | LogLevel>('ALL');
  let query = $state('');

  async function load() {
    if (!app.services) return;
    logs = (await app.services.listLogs())
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 400);
  }

  $effect(() => {
    app.snapshot;
    void load();
  });

  const filtered = $derived(
    logs.filter((entry) => {
      if (level !== 'ALL' && entry.level !== level) return false;
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return (
        entry.message.toLowerCase().includes(needle) ||
        entry.category.toLowerCase().includes(needle) ||
        entry.context.toLowerCase().includes(needle)
      );
    })
  );

  async function clear() {
    if (!window.confirm('Clear all activity logs? Leave, duty and policy records are not affected.')) return;
    await app.perform((services) => services.clearLogs(), 'Logs cleared.');
    await load();
  }

  function toneFor(value: LogLevel) {
    if (value === 'ERROR') return 'danger' as const;
    if (value === 'WARN') return 'warning' as const;
    if (value === 'DEBUG') return 'neutral' as const;
    return 'info' as const;
  }
</script>

<PageHeader
  title="Activity logs"
  subtitle="Local diagnostics only. Never includes clinical or patient data."
>
  <Button size="sm" variant="ghost" onclick={clear}>Clear logs</Button>
</PageHeader>

<Card>
  <div class="form-grid" style="margin-bottom:8px">
    <Select
      label="Level"
      bind:value={level}
      options={[
        { value: 'ALL', label: 'All levels' },
        { value: 'ERROR', label: 'Errors' },
        { value: 'WARN', label: 'Warnings' },
        { value: 'INFO', label: 'Information' },
        { value: 'DEBUG', label: 'Debug' }
      ]}
    />
    <Field label="Search" bind:value={query} placeholder="Message, category or context" />
  </div>
  <div class="between" style="margin-bottom:6px">
    <span class="tiny muted">{filtered.length} entries shown · {logs.length} loaded</span>
    <span class="tiny muted">Kept for {app.settings?.logRetentionDays ?? 30} days</span>
  </div>

  {#if filtered.length === 0}
    <EmptyState title="No matching log entries" text="Actions such as saving leave, duties and imports are recorded here according to the enabled levels." />
  {:else}
    <div class="table-wrap">
      <table class="table-base">
        <thead>
          <tr><th>When</th><th>Level</th><th>Area</th><th>Message</th><th>Context</th></tr>
        </thead>
        <tbody>
          {#each filtered as entry (entry.id)}
            <tr>
              <td style="white-space:nowrap">{formatDateTime(entry.at)}</td>
              <td><Badge tone={toneFor(entry.level)}>{entry.level}</Badge></td>
              <td>{entry.category}</td>
              <td>{entry.message}</td>
              <td class="tiny muted">{entry.context || '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</Card>
