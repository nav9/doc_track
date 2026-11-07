# DocTrack — Doctor Leave Planner

DocTrack is a local-first web application for doctors at a medical college
hospital. It plans leave against the department's leave rules, derives
balances from a transaction ledger, records night duties and their PDO/CCL
consequences, tracks NMC attendance, and produces a monthly A4 duty roster PDF.

Everything is stored in the browser's IndexedDB. There is no account, server,
analytics, telemetry or external personal-data request.

**Phase 1 status:** implemented and verified by type check, 151 Vitest tests,
5 Playwright browser journeys and a production build. Multi User planning is
local-first; authenticated multi-device sync and an HOD approval queue remain
future work.

- **Application (target URL):** https://nav9.github.io/doc_track/
- **Policy Studio:** https://nav9.github.io/doc_track/#/admin/policy-studio
- **Local Policy Studio:** http://localhost:5173/#/admin/policy-studio
- http://127.0.0.1:4173/doc_track/

The Policy Studio is intentionally reachable without sign-in. It is a policy
configuration screen, not a security boundary, and it is linked here as required
by decision D-006.

## What Phase 1 includes

- **Profile and employment** — editable doctor profile, joining date and
  employment details; the profile survives reloads in IndexedDB.
- **Leave rules** — readable category-by-category rules generated from the
  active policy version, with the source of each value.
- **Policy Studio** — edit a draft of the effective-dated policy, see validation
  errors and warnings, preview the JSON, publish a new immutable version, and
  export/import policy drafts. A policy lab evaluates ad-hoc leave requests
  against the draft without saving them.
- **Ledger-derived balances** — credits, debits, adjustments, cancellations and
  reversals; balances are never edited as a bare number. CCL credits are
  individual records with earned and expiry dates and are consumed
  earliest-expiry first.
- **Planner** — exact-range checks and window search, explanations for every
  result, calendar selection and planned (not approved) suggestions. Leave can
  be recorded as planned, approved, rejected or cancelled.
- **Duty, PDO and CCL** — completed 24-hour duty creates next-day PDO; PDO on a
  weekend/holiday, working a PDO with a punch-out by 16:00, or an unused PDO
  converts to CCL. A qualifying weekend/holiday duty earns CCL.
- **Attendance and NMC** — confirmed/absent punches, derived assumed punches for
  past and current non-Sunday, non-leave, non-holiday days, and the monthly
  21-punch NMC view. Future days remain “future”, never assumed.
- **Duty roster and PDF** — monthly roster entries synced to duties, on-screen
  preview, and a real client-side A4 PDF with vector table, page numbers and a
  signature/approval block.
- **Data management** — full/leave/policy exports, validated imports with a
  preview, autosave before import, full version snapshots with rollback, activity
  logs, JSON/text backup and restore, and CSV ledger export.
- **Local-first web app** — runs as an ordinary Svelte site. PWA installation,
  service-worker precaching and offline startup are deferred.

## Run locally

Requires Node.js 22 or newer (developed on Node 26) and npm.

```bash
npm install
npm run dev
```

Vite serves the app at http://127.0.0.1:5173/. The first screen creates the local
profile; no dummy data is inserted on first run.

Checks:

```bash
npm run check    # svelte-check, zero errors
npm test         # Vitest unit + IndexedDB integration tests
npm run test:e2e # Playwright: onboarding, planning, import/rollback, roster PDF
npm run build    # production build into dist/
npm run preview  # serve the production build
```

Or use the interactive developer menu:

```bash
python3 menu.py
```

It builds, cleans and builds, runs the app, and can launch a separate test-data
origin at http://127.0.0.1:5174/ with a sample profile, leave adjustment, event,
attendance and roster doctors.

A GitHub Pages build uses the repository base path:

```bash
BASE_PATH=/doc_track/ npm run build
```

## Data safety

Browser storage is not a backup. Clearing site data, using private browsing, or
an operating system cleanup can delete records. Export a full backup from
**Settings → Backup** and keep the file outside the browser. The app requests
persistent storage where the browser supports it, but cannot prevent deletion.

## Deploy to GitHub Pages

`.github/workflows/deploy.yml` builds and publishes `dist/` on every push to
`main` (or by manual dispatch). In the repository, set **Settings → Pages →
Build and deployment → Source** to **GitHub Actions**. The workflow sets
`BASE_PATH=/<repository-name>/` so assets resolve under the project path. It
runs the type check, unit tests and Playwright journeys before publishing. CI
installs its own Chromium; local Playwright runs continue to use system Chrome.

The Pages source is a one-time repository setting. A workflow using the default
`GITHUB_TOKEN` cannot enable Pages on its own; if the source is not set to
**GitHub Actions**, the deployment job stops with a Pages configuration error.
Once enabled, every successful push to `main` publishes the site.

The app uses hash routing (`#/planner`, `#/admin/policy-studio`), so deep links
work on GitHub Pages without server rewrites.

## Policy model and open questions

Policies are versioned, effective-dated records. Published versions are
immutable; editing creates a draft, validation must pass, and publishing creates
a new version. Rules are typed data — never arbitrary JavaScript or an AI
evaluator. The default `Medical College Leave Policy` is seeded on first run and
is fully editable.

Values that the source documents leave ambiguous remain documented in
[`POLICY_ASSUMPTIONS.md`](POLICY_ASSUMPTIONS.md), including CCL expiry boundaries,
EL year definition, RH month-end periods, night-duty start time, unused-PDO
conversion timing and joining-year proration. Architectural choices and
deviations are in [`DECISIONS.md`](DECISIONS.md), and the implemented module map
is in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Project layout

```text
src/
├── lib/
│   ├── domain/          # typed entities, dates, default medical-college policy
│   ├── engines/         # pure policy, ledger, leave, duty, attendance, planning
│   ├── application/     # AppServices use cases and snapshot DTOs
│   ├── infrastructure/  # IndexedDB repositories, import/export, PDF
│   ├── components/ui/   # hand-built shadcn-style primitives and calendar
│   └── app/             # reactive state, hash router, display helpers
├── routes/              # all screens (dashboard, planner, roster, policy studio…)
├── App.svelte           # shell, navigation, onboarding gate, route switch
└── main.ts              # mount the Svelte application
```

Business rules live in `domain`/`engines`; Svelte components call
`application/services/appServices.ts` and never open IndexedDB directly.

## Known limitations

- Single-doctor UI in Phase 1. The data model keeps organisations, employments
  and doctor IDs so multiple doctors can be added later.
- No automated multi-doctor roster generation, fairness optimisation or HR
  approval workflow (deferred by D-017).
- Playwright launches the system Google Chrome (`channel: 'chrome'`) so no
  duplicate browser download is needed. The suite covers onboarding, leave
  planning, export → import → rollback, and roster PDF generation. Real-device
  visual and touch checks remain manual.
- No PWA support in Phase 1: there is no service worker, install prompt,
  manifest generation or Workbox dependency.
- No charting library; dashboard indicators are CSS bars. This is documented in
  `DECISIONS.md`.
- `svelte-check` reports zero errors and zero warnings.
- The PDF is a generated vector table, not an editable form. It includes date,
  duty type, doctor, employee ID, department, unit, time, remarks, weekend
  shading and the signature block.

## Further documentation

- [`PHASE1_IMPLEMENTATION_PROMPT.md`](PHASE1_IMPLEMENTATION_PROMPT.md) — Phase 1
  acceptance criteria and working rules.
- [`PHASE1_PROGRESS.md`](PHASE1_PROGRESS.md) — stage-by-stage status, checks,
  known issues and next task.
- [`OriginalPrompt.txt`](OriginalPrompt.txt) — source medical-college rules and
  original UX intent.
