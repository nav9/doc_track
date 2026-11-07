/**
 * Hash routing.
 *
 * GitHub Pages serves project sites without server-side rewrites, so the app
 * uses `#/path` instead of the History API. Every route can therefore be
 * bookmarked, reloaded and used offline.
 */

function readPath(): string {
  if (typeof window === 'undefined') return '/';
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export const router = $state({ path: readPath() });

let started = false;

export function initRouter(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const sync = () => {
    router.path = readPath();
  };
  window.addEventListener('hashchange', sync);
  sync();
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (typeof window === 'undefined') {
    router.path = path;
    return;
  }
  if (router.path === path) return;
  if (options.replace) {
    window.history.replaceState(null, '', `#${path}`);
    router.path = path;
  } else {
    window.location.hash = path;
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

export function currentPath(): string {
  return router.path.replace(/\/+$/, '') || '/';
}

export const ROUTE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/planner': 'Leave planner',
  '/roster': 'Duty roster',
  '/multi-user': 'Multi User',
  '/leave-rules': 'Leave rules',
  '/attendance': 'NMC attendance',
  '/account': 'Account',
  '/versions': 'Version history',
  '/logs': 'Activity logs',
  '/settings': 'Settings',
  '/admin/policy-studio': 'Policy Studio',
  '/about': 'About DocTrack'
};
