<script lang="ts">
  import { History, RotateCcw, Trash2 } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import { navigate } from '../lib/app/router.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import Dialog from '../lib/components/ui/Dialog.svelte';
  import EmptyState from '../lib/components/ui/EmptyState.svelte';
  import type { DataVersion } from '../lib/application/dto/version';
  import { formatDateTime } from '../lib/domain/common/dates';

  let versions = $state<DataVersion[]>([]);
  let activity = $state({ total: 0, averagePerDay: 0, recent: 0 });
  let selected = $state<DataVersion | null>(null);
  let action = $state<'restore' | 'delete'>('restore');

  async function load() {
    if (!app.services) return;
    versions = (await app.services.listVersions())
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    activity = await app.services.versionActivity();
  }

  $effect(() => {
    app.snapshot;
    void load();
  });

  function ask(version: DataVersion, kind: 'restore' | 'delete') {
    selected = version;
    action = kind;
  }

  async function confirm() {
    if (!selected) return;
    const version = selected;
    selected = null;
    if (action === 'restore') {
      await app.perform(
        (services) => services.rollbackTo(version.id),
        'Version restored. The state before restoring was saved as a new version.'
      );
    } else {
      await app.perform((services) => services.deleteVersion(version.id), 'Version deleted.');
    }
    await load();
  }
</script>

<PageHeader
  title="Version history"
  subtitle="Snapshots taken before imports and restores. Stored locally, never uploaded."
>
  <Badge tone={activity.averagePerDay > 3 ? 'warning' : 'neutral'}>
    {activity.averagePerDay}/day average · {activity.recent} in 30 days
  </Badge>
</PageHeader>

{#if app.settings && !app.settings.versioningEnabled}
  <div class="banner banner-warning" style="margin-bottom:12px">
    <div class="grow">
      Version snapshots are disabled, so imports and restores cannot be reversed from here.
    </div>
    <a class="btn btn-secondary btn-sm" href="#/settings">Enable in Settings</a>
  </div>
{/if}

{#if app.lastError}
  <div class="banner banner-danger" style="margin-bottom:12px">{app.lastError.message}</div>
{/if}

{#if versions.length === 0}
  <EmptyState
    title="No snapshots yet"
    text="A snapshot is saved automatically before an import or a restore. You can also create one from the data settings."
  >
    <Button variant="secondary" onclick={() => navigate('/settings')}>Open data settings</Button>
  </EmptyState>
{:else}
  <Card>
    <div class="section-card-head">
      <h2>Saved snapshots</h2>
      <span class="tiny muted">{versions.length} of {app.settings?.versionRetention ?? 20} retained</span>
    </div>
    <div class="stack-sm">
      {#each versions as version (version.id)}
        <div class="list-row" style="align-items:flex-start">
          <span class="chip cat-duty"><History size={11} /> {version.reason}</span>
          <div class="list-main">
            <div class="list-title">{version.label}</div>
            <div class="tiny muted">{formatDateTime(version.createdAt)}</div>
            <div class="tiny muted" style="margin-top:2px">{version.summary}</div>
            <div class="row" style="margin-top:4px;gap:4px">
              <Badge tone="neutral">{version.counts.leaveRequests} leave</Badge>
              <Badge tone="neutral">{version.counts.ledgerEntries} ledger</Badge>
              <Badge tone="neutral">{version.counts.duties} duties</Badge>
              <Badge tone="neutral">{version.counts.rosterMonths} rosters</Badge>
              <Badge tone="neutral">{version.counts.policyVersions} policies</Badge>
            </div>
          </div>
          <div class="row" style="gap:3px">
            <Button size="sm" variant="secondary" onclick={() => ask(version, 'restore')}>
              <RotateCcw size={12} /> Restore
            </Button>
            <Button size="sm" variant="ghost" onclick={() => ask(version, 'delete')}>
              <Trash2 size={13} />
            </Button>
          </div>
        </div>
      {/each}
    </div>
  </Card>
{/if}

<Dialog
  open={selected !== null}
  title={action === 'restore' ? 'Restore this snapshot?' : 'Delete this snapshot?'}
  subtitle={selected ? `${selected.label} · ${formatDateTime(selected.createdAt)}` : ''}
  onclose={() => (selected = null)}
>
  {#if action === 'restore'}
    <p class="small">
      All local records will be replaced with the snapshot. DocTrack first saves the current state
      as a new version, so this can be undone. Exports you already downloaded are unaffected.
    </p>
  {:else}
    <p class="small">
      The snapshot is removed. Leave and duty records are not affected. This cannot be undone.
    </p>
  {/if}
  <div class="row" style="margin-top:10px">
    <Button variant={action === 'delete' ? 'danger' : 'primary'} onclick={confirm}>
      {action === 'restore' ? 'Restore snapshot' : 'Delete snapshot'}
    </Button>
    <Button variant="ghost" onclick={() => (selected = null)}>Cancel</Button>
  </div>
</Dialog>
