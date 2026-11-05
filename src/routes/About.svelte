<script lang="ts">
  import { ShieldCheck, Stethoscope } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import { APP_NAME, APP_TAGLINE, APP_VERSION } from '../lib/app/version';
  import { bytesText } from '../lib/app/ui';
</script>

<PageHeader title="About DocTrack" subtitle={APP_TAGLINE}>
  <Badge tone="success">Version {APP_VERSION}</Badge>
</PageHeader>

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;align-items:start">
  <div class="stack">
    <Card>
      <div class="row" style="align-items:center;gap:10px">
        <span class="brand-mark"><Stethoscope size={18} /></span>
        <div>
          <strong>{APP_NAME} {APP_VERSION}</strong>
          <div class="tiny muted">Offline-first leave planning for medical college doctors</div>
        </div>
      </div>
      <p class="small" style="margin:10px 0 0">
        DocTrack checks leave against a versioned department policy, keeps balances in a ledger,
        tracks duties and post-duty off, and projects NMC attendance. It is a planning aid, not
        an approval system.
      </p>
      <div class="banner banner-info" style="margin-top:9px">
        <ShieldCheck class="banner-icon" size={15} />
        <div>
          <strong>No server, no account, no tracking</strong>
          <p class="tiny muted" style="margin:2px 0 0">
            There are no analytics, no external requests and no AI evaluation. Every rule is
            deterministic and every record is stored in this browser’s IndexedDB.
          </p>
        </div>
      </div>
    </Card>

    <Card>
      <div class="section-card-head"><h2>Policy currently in force</h2></div>
      {#if app.activePolicy}
        <dl class="detail-grid">
          <div><dt>Name</dt><dd>{app.activePolicy.name}</dd></div>
          <div><dt>Version</dt><dd>{app.activePolicy.version}</dd></div>
          <div><dt>Effective from</dt><dd>{app.activePolicy.effectiveFrom}</dd></div>
          <div><dt>Status</dt><dd>{app.activePolicy.status}</dd></div>
          <div><dt>Source</dt><dd>{app.activePolicy.source}</dd></div>
          <div><dt>Categories</dt><dd>{app.activePolicy.categories.filter((category) => category.enabled).length}</dd></div>
        </dl>
        <div class="row" style="margin-top:8px">
          <a class="btn btn-secondary btn-sm" href="#/leave-rules">Read the rules</a>
          <a class="btn btn-subtle btn-sm" href="#/admin/policy-studio">Policy Studio</a>
        </div>
      {:else}
        <p class="tiny muted">No published policy is active. Open the Policy Studio to publish one.</p>
      {/if}
    </Card>

    <Card>
      <div class="section-card-head"><h2>Important limits</h2></div>
      <ul class="reasons">
        <li class="reason reason-warning">
          A “planned” leave is not approved leave. Only the department can approve it.
        </li>
        <li class="reason reason-warning">
          Assumed attendance is derived from the working calendar, never from verified punches.
        </li>
        <li class="reason reason-warning">
          Clearing browser data deletes DocTrack. Keep a recent export outside the browser.
        </li>
        <li class="reason reason-info">
          Where the department circular is silent, the choice is recorded in POLICY_ASSUMPTIONS.md
          and can be changed in the Policy Studio.
        </li>
      </ul>
    </Card>
  </div>

  <div class="stack">
    <Card>
      <div class="section-card-head"><h2>This device</h2></div>
      <dl class="detail-grid">
        <div><dt>Records</dt><dd>{app.snapshot.leaves.length} leave · {app.snapshot.ledger.length} ledger</dd></div>
        <div><dt>Duties</dt><dd>{app.snapshot.duties.length}</dd></div>
        <div><dt>Rosters</dt><dd>{app.snapshot.rosters.length} month(s)</dd></div>
        <div><dt>Holidays</dt><dd>{app.snapshot.holidays.length}</dd></div>
        <div><dt>Policies</dt><dd>{app.snapshot.policies.length} version(s)</dd></div>
        {#if app.storage}
          <div><dt>Browser storage</dt><dd>{bytesText(app.storage.usage)} of {bytesText(app.storage.quota)}</dd></div>
        {/if}
      </dl>
      <p class="tiny muted" style="margin:8px 0 0">
        The app installs as a PWA after the first online load. After that, the interface, fonts,
        icons and PDF generation all work without a network.
      </p>
    </Card>

    <Card>
      <div class="section-card-head"><h2>Built with</h2></div>
      <dl class="detail-grid">
        <div><dt>Framework</dt><dd>Svelte 5 + Vite + TypeScript</dd></div>
        <div><dt>Styling</dt><dd>Tailwind CSS v4 tokens</dd></div>
        <div><dt>Storage</dt><dd>IndexedDB via idb</dd></div>
        <div><dt>PDF</dt><dd>jsPDF, vector A4 output</dd></div>
        <div><dt>Font</dt><dd>Inter, bundled locally (SIL OFL)</dd></div>
        <div><dt>Icons</dt><dd>Lucide (ISC)</dd></div>
      </dl>
      <p class="tiny muted" style="margin:8px 0 0">
        No paid services, CDNs, remote fonts or third-party data processors are used.
      </p>
    </Card>

    <Card>
      <div class="section-card-head"><h2>Deployment</h2></div>
      <p class="small" style="margin:0">
        DocTrack builds to static files and is published on GitHub Pages. Hash-based routes work
        without server rewrites. The service worker precaches the built assets so the installed
        app opens offline.
      </p>
      <div class="row" style="margin-top:8px">
        <a class="btn btn-secondary btn-sm" href="#/settings">Backup settings</a>
        <a class="btn btn-ghost btn-sm" href="#/">Dashboard</a>
      </div>
    </Card>
  </div>
</div>
