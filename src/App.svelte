<script lang="ts">
  import { onMount } from 'svelte';
  import {
    BookOpenText,
    CalendarCheck,
    CalendarDays,
    ClipboardList,
    Clock,
    History,
    Info,
    LayoutDashboard,
    Menu,
    Moon,
    Settings,
    ShieldCheck,
    Stethoscope,
    Sun,
    Users,
    UserRound,
    X
  } from '@lucide/svelte';
  import { app } from './lib/app/state.svelte';
  import { ROUTE_TITLES, currentPath, initRouter, navigate, router } from './lib/app/router.svelte';
  import { initials } from './lib/domain/profile/profile';
  import ToastHost from './lib/components/ui/ToastHost.svelte';
  import Onboarding from './routes/Onboarding.svelte';
  import Dashboard from './routes/Dashboard.svelte';
  import Planner from './routes/Planner.svelte';
  import Roster from './routes/Roster.svelte';
  import MultiUser from './routes/MultiUser.svelte';
  import LeaveRules from './routes/LeaveRules.svelte';
  import Attendance from './routes/Attendance.svelte';
  import Account from './routes/Account.svelte';
  import SettingsView from './routes/Settings.svelte';
  import Versions from './routes/Versions.svelte';
  import Logs from './routes/Logs.svelte';
  import About from './routes/About.svelte';
  import PolicyStudio from './routes/PolicyStudio.svelte';
  import { APP_VERSION } from './lib/app/version';
  import { seedTestData } from './lib/app/testData';

  const primaryNav = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/planner', label: 'Planner', icon: CalendarDays },
    { path: '/roster', label: 'Duty roster', icon: ClipboardList },
    { path: '/multi-user', label: 'Multi User', icon: Users },
    { path: '/leave-rules', label: 'Leave rules', icon: BookOpenText },
    { path: '/attendance', label: 'Attendance', icon: CalendarCheck }
  ];

  const secondaryNav = [
    { path: '/account', label: 'Account', icon: UserRound },
    { path: '/versions', label: 'Version history', icon: History },
    { path: '/logs', label: 'Activity logs', icon: Clock },
    { path: '/settings', label: 'Settings', icon: Settings },
    { path: '/admin/policy-studio', label: 'Policy Studio', icon: ShieldCheck },
    { path: '/about', label: 'About', icon: Info }
  ];

  let menuOpen = $state(false);
  const path = $derived(currentPath());
  const pageTitle = $derived(ROUTE_TITLES[path] ?? 'DocTrack');
  const profile = $derived(app.profile);

  $effect(() => {
    const theme = app.effectiveTheme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.colorblind = app.settings?.colorblind ? 'true' : 'false';
  });

  $effect(() => {
    // Close the mobile drawer whenever the route changes.
    path;
    menuOpen = false;
  });

  onMount(() => {
    initRouter();
    void (async () => {
      await app.init();
      if (import.meta.env.VITE_DOCTRACK_TEST_DATA !== 'true' || !app.services) return;
      try {
        const seeded = await seedTestData(app.services);
        if (seeded) await app.refresh();
      } catch (error) {
        console.error('[DocTrack] Test data could not be loaded.', error);
      }
    })();
  });

  function go(target: string) {
    menuOpen = false;
    navigate(target);
  }

  async function toggleTheme() {
    if (!app.settings) return;
    const next = app.effectiveTheme === 'dark' ? 'light' : 'dark';
    await app.perform((services) => services.saveSettings({ theme: next }));
  }
</script>

{#if app.loading}
  <div class="onboarding">
    <div class="card card-pad" style="width:min(420px,100%);text-align:center">
      <div class="brand-mark" style="margin:0 auto 10px">
        <Stethoscope size={18} />
      </div>
      <h1 style="font-size:1.1rem">Opening DocTrack</h1>
      <p class="muted small" style="margin:4px 0 0">
        Reading this device’s local database. Nothing is sent over the network.
      </p>
    </div>
  </div>
{:else if app.fatal}
  <div class="onboarding">
    <div class="card card-pad" style="width:min(520px,100%)">
      <h1 style="font-size:1.1rem">DocTrack could not start</h1>
      <div class="banner banner-danger" style="margin:10px 0">{app.fatal}</div>
      <p class="muted small">
        DocTrack stores everything in this browser’s IndexedDB. Private browsing and some
        restricted profiles block it. Open the app in a normal window, then retry.
      </p>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-primary" onclick={() => void app.init()}>Retry</button>
        <a class="btn btn-secondary" href="#/about">About DocTrack</a>
      </div>
    </div>
  </div>
{:else if !app.settings?.onboarded || !profile}
  <Onboarding />
{:else}
  <div class="app-shell">
    <aside class="sidebar" class:open={menuOpen} aria-label="Main navigation">
      <a class="brand" href="#/" onclick={() => (menuOpen = false)}>
        <span class="brand-mark"><Stethoscope size={18} /></span>
        <span>
          <span class="brand-name">DocTrack</span>
          <span class="brand-sub">Medical College</span>
        </span>
      </a>

      <nav class="nav-group">
        <span class="nav-heading">Workspace</span>
        {#each primaryNav as item (item.path)}
          {@const Icon = item.icon}
          <a
            class="nav-item"
            class:active={path === item.path}
            href={`#${item.path}`}
            aria-current={path === item.path ? 'page' : undefined}
            onclick={() => (menuOpen = false)}
          >
            <span class="nav-icon"><Icon size={15} /></span>
            {item.label}
          </a>
        {/each}
      </nav>

      <nav class="nav-group">
        <span class="nav-heading">Manage</span>
        {#each secondaryNav as item (item.path)}
          {@const Icon = item.icon}
          <a
            class="nav-item"
            class:active={path === item.path}
            href={`#${item.path}`}
            aria-current={path === item.path ? 'page' : undefined}
            onclick={() => (menuOpen = false)}
          >
            <span class="nav-icon"><Icon size={15} /></span>
            {item.label}
          </a>
        {/each}
      </nav>

      <div class="sidebar-foot">
        <strong style="color:#c3cede">Local-first</strong><br />
        Everything stays in this browser. Export a backup regularly.
        <div style="margin-top:8px">Version {APP_VERSION}</div>
      </div>
    </aside>

    {#if menuOpen}
      <div class="sidebar-scrim" role="presentation" onclick={() => (menuOpen = false)}></div>
    {/if}

    <div class="app-main">
      <header class="topbar">
        <div class="topbar-left">
          <button
            type="button"
            class="icon-btn mobile-only"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onclick={() => (menuOpen = !menuOpen)}
          >
            {#if menuOpen}<X size={17} />{:else}<Menu size={17} />{/if}
          </button>
          <span class="topbar-title">{pageTitle}</span>
        </div>
        <div class="topbar-right">
          {#if app.isSimulated}
            <a class="sim-badge" href="#/settings" title="Simulated clock is enabled in Settings">
              <Clock size={11} /> {app.today}
            </a>
          {/if}
          <button
            type="button"
            class="icon-btn"
            aria-label="Toggle colour theme"
            title="Toggle light or dark theme"
            onclick={toggleTheme}
          >
            {#if app.effectiveTheme === 'dark'}<Sun size={16} />{:else}<Moon size={16} />{/if}
          </button>
          <a class="avatar" href="#/account" title="Account">
            {initials(profile)}
          </a>
        </div>
      </header>

      {#if path === '/'}
        <Dashboard />
      {:else if path === '/planner'}
        <Planner />
      {:else if path === '/roster'}
        <Roster />
      {:else if path === '/multi-user'}
        <MultiUser />
      {:else if path === '/leave-rules'}
        <LeaveRules />
      {:else if path === '/attendance'}
        <Attendance />
      {:else if path === '/account'}
        <Account />
      {:else if path === '/settings'}
        <SettingsView />
      {:else if path === '/versions'}
        <Versions />
      {:else if path === '/logs'}
        <Logs />
      {:else if path === '/about'}
        <About />
      {:else if path === '/admin/policy-studio'}
        <PolicyStudio />
      {:else}
        <div class="card card-pad">
          <h1 style="font-size:1.15rem">Page not found</h1>
          <p class="muted small">The address “{path}” is not part of DocTrack.</p>
          <button class="btn btn-primary" onclick={() => go('/')}>Go to the dashboard</button>
        </div>
      {/if}

      <footer class="app-footer">
        <span>DocTrack {APP_VERSION} · all calculations happen on this device.</span>
        <span>Leave rules follow the department policy; check the approved circular before applying.</span>
      </footer>
    </div>
  </div>
{/if}

<ToastHost />
