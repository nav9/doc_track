<script lang="ts">
  import { AlertTriangle, ArrowRight, CalendarPlus, Download } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import { navigate } from '../lib/app/router.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import ProgressBar from '../lib/components/ui/ProgressBar.svelte';
  import CalendarMonth from '../lib/components/CalendarMonth.svelte';
  import {
    buildRecommendations,
    type Recommendation
  } from '../lib/engines/recommendation-engine/recommendationEngine';
  import { computeMonthAttendance } from '../lib/engines/attendance-engine/attendanceEngine';
  import { backupDue } from '../lib/domain/settings/types';
  import { SHORT_MONTH_NAMES, daysInMonth, eachDate, formatDate } from '../lib/domain/common/dates';
  import { isActiveLeave, leaveStatusLabel } from '../lib/domain/leave/types';
  import {
    addMark,
    categoryChipClass,
    daysText,
    percent,
    rangeText,
    toneForCategory,
    type DayMark
  } from '../lib/app/ui';

  const today = $derived(app.today);
  const profile = $derived(app.profile);
  const policy = $derived(app.activePolicy);
  const dateFormat = $derived(app.settings?.dateFormat ?? 'dd MMM yyyy');

  let calYear = $state(Number(app.today.slice(0, 4)));
  let calMonth = $state(Number(app.today.slice(5, 7)));

  const monthStart = $derived(
    `${calYear}-${String(calMonth).padStart(2, '0')}-01`
  );
  const monthEnd = $derived(
    `${calYear}-${String(calMonth).padStart(2, '0')}-${String(daysInMonth(calYear, calMonth)).padStart(2, '0')}`
  );

  const report = $derived.by(() => {
    if (!policy) return null;
    return computeMonthAttendance({
      year: calYear,
      month: calMonth,
      weekendDays: policy.work.weekendDays,
      holidays: app.snapshot.holidays,
      leaves: app.snapshot.leaves,
      records: app.snapshot.attendance,
      required: policy.work.nmcRequiredPunchesPerMonth,
      today
    });
  });

  const marks = $derived.by(() => {
    const map: Record<string, DayMark[]> = {};
    for (const holiday of app.snapshot.holidays) {
      if (holiday.date >= monthStart && holiday.date <= monthEnd) {
        addMark(map, holiday.date, holiday.kind, holiday.kind === 'GH' ? 'gh' : 'rh');
      }
    }
    for (const leave of app.snapshot.leaves) {
      if (!isActiveLeave(leave)) continue;
      const from = leave.startDate > monthStart ? leave.startDate : monthStart;
      const to = leave.endDate < monthEnd ? leave.endDate : monthEnd;
      if (from > to) continue;
      for (const date of eachDate(from, to)) {
        addMark(map, date, leave.category, toneForCategory(leave.category));
      }
    }
    for (const duty of app.snapshot.duties) {
      if (duty.status === 'cancelled' || duty.date < monthStart || duty.date > monthEnd) continue;
      addMark(map, duty.date, 'Duty', 'duty');
    }
    for (const pdo of app.snapshot.pdos) {
      if (pdo.status === 'scheduled' && pdo.date >= monthStart && pdo.date <= monthEnd) {
        addMark(map, pdo.date, 'PDO', 'pdo');
      }
    }
    for (const event of app.snapshot.events) {
      const eventEnd = event.endDate ?? event.date;
      if (eventEnd < monthStart || event.date > monthEnd) continue;
      const from = event.date > monthStart ? event.date : monthStart;
      const to = eventEnd < monthEnd ? eventEnd : monthEnd;
      for (const date of eachDate(from, to)) addMark(map, date, event.title, 'event');
    }
    return map;
  });

  const leaveTypes = [
    { code: 'CL', label: 'CL' },
    { code: 'CCL', label: 'CCL' },
    { code: 'EL', label: 'EL' },
    { code: 'SPCL', label: 'SpCL' }
  ] as const;

  const leaveSummaries = $derived.by(() =>
    leaveTypes.map(({ code, label }) => {
      const balance = app.balances[code];
      const pending = Math.max(0, balance?.pending ?? 0);
      return {
        code,
        label,
        available: balance?.available ?? 0,
        // The ledger's used figure includes pending debits; split them so the
        // dashboard can show approved usage and approvals waiting separately.
        used: Math.max(0, (balance?.used ?? 0) - pending),
        pending,
        periodLabel: balance?.periodLabel ?? 'Current period',
        fullForm: app.categories.find((category) => category.code === code)?.fullForm ?? label
      };
    })
  );

  const shownBalances = $derived(
    leaveSummaries.flatMap((leave) => {
      const balance = app.balances[leave.code];
      return balance ? [balance] : [];
    })
  );

  const holidayAvailability = $derived.by(() => {
    const year = today.slice(0, 4);
    const yearEnd = `${year}-12-31`;
    const remaining = app.snapshot.holidays.filter(
      (holiday) => holiday.date >= today && holiday.date <= yearEnd
    );
    return {
      year,
      gh: remaining.filter((holiday) => holiday.kind === 'GH').length,
      rh: remaining.filter((holiday) => holiday.kind === 'RH').length,
      rhQuota: Math.max(0, app.balances.RH?.available ?? 0)
    };
  });

  function leaveNumber(value: number): string {
    return String(Math.round(value * 100) / 100);
  }

  const recommendations = $derived.by<Recommendation[]>(() => {
    if (!app.settings) return [];
    return buildRecommendations({
      today,
      balances: app.balances,
      ledger: app.snapshot.ledger,
      leaves: app.snapshot.leaves,
      duties: app.snapshot.duties,
      pdos: app.snapshot.pdos,
      holidays: app.snapshot.holidays,
      events: app.snapshot.events,
      attendance: report,
      policy,
      settings: app.settings
    });
  });

  const backupNeeded = $derived(Boolean(app.settings && backupDue(app.settings, today)));

  const todayLeave = $derived(
    app.snapshot.leaves.find(
      (leave) => isActiveLeave(leave) && today >= leave.startDate && today <= leave.endDate
    ) ?? null
  );
  const todayDuty = $derived(
    app.snapshot.duties.find((duty) => duty.status !== 'cancelled' && duty.date === today) ?? null
  );
  const todayPdo = $derived(
    app.snapshot.pdos.find((pdo) => pdo.status === 'scheduled' && pdo.date === today) ?? null
  );
  const todayEvents = $derived(
    app.snapshot.events.filter(
      (event) => event.date <= today && (event.endDate ?? event.date) >= today
    )
  );

  const upcoming = $derived.by(() => {
    const items: { date: string; title: string; detail: string; tone: string; badge: string }[] = [];
    for (const duty of app.snapshot.duties) {
      if (duty.status === 'cancelled' || duty.date < today) continue;
      items.push({
        date: duty.date,
        title: duty.shiftName,
        detail: `${duty.startTime} – ${duty.endTime}${duty.crossesMidnight ? ' (+1 day)' : ''}`,
        tone: 'duty',
        badge: duty.status === 'completed' ? 'Completed' : 'Duty'
      });
    }
    for (const leave of app.snapshot.leaves) {
      if (!isActiveLeave(leave) || leave.endDate < today) continue;
      items.push({
        date: leave.startDate < today ? today : leave.startDate,
        title: `${leave.category} leave`,
        detail: rangeText(leave.startDate, leave.endDate, dateFormat),
        tone: toneForCategory(leave.category),
        badge: leaveStatusLabel(leave.status)
      });
    }
    for (const pdo of app.snapshot.pdos) {
      if (pdo.status !== 'scheduled' || pdo.date < today) continue;
      items.push({
        date: pdo.date,
        title: 'Post-duty off',
        detail: 'Scheduled after a completed duty',
        tone: 'pdo',
        badge: 'PDO'
      });
    }
    for (const holiday of app.snapshot.holidays) {
      if (holiday.date < today) continue;
      items.push({
        date: holiday.date,
        title: holiday.name,
        detail: holiday.kind === 'GH' ? 'General holiday' : 'Restricted holiday',
        tone: holiday.kind === 'GH' ? 'gh' : 'rh',
        badge: holiday.kind
      });
    }
    for (const event of app.snapshot.events) {
      if ((event.endDate ?? event.date) < today) continue;
      items.push({
        date: event.date < today ? today : event.date,
        title: event.title,
        detail: event.type,
        tone: 'event',
        badge: 'Event'
      });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)).slice(0, 7);
  });

  const recentLedger = $derived(
    app.snapshot.ledger
      .slice()
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.effectiveDate.localeCompare(a.effectiveDate))
      .slice(0, 6)
  );

  function shiftMonth(delta: number) {
    const total = calYear * 12 + (calMonth - 1) + delta;
    calYear = Math.floor(total / 12);
    calMonth = ((total % 12) + 12) % 12 + 1;
  }

  function openRecommendation(recommendation: Recommendation) {
    switch (recommendation.action.type) {
      case 'planner':
        navigate('/planner');
        break;
      case 'attendance':
        navigate('/attendance');
        break;
      case 'duty':
        navigate('/planner');
        break;
      case 'rules':
        navigate('/leave-rules');
        break;
      case 'backup':
        void app.backupNow();
        break;
    }
  }

  const greeting = $derived.by(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  });
</script>

<PageHeader
  title={`${greeting}${profile ? `, ${profile.prefix} ${profile.name}` : ''}`}
  subtitle={`${formatDate(today, dateFormat)} · ${profile?.department ?? ''}${
    todayLeave ? ` · on ${todayLeave.category} leave today` : ''
  }`}
>
  <Button variant="success" onclick={() => navigate('/planner')}>
    <CalendarPlus size={14} /> Apply/Plan leave
  </Button>
  <Button onclick={() => navigate('/roster')}>Open duty roster</Button>
  <Button variant="secondary" onclick={() => navigate('/multi-user')}>Multi User</Button>
</PageHeader>

{#if backupNeeded || (app.settings && !app.settings.storageWarningDismissed)}
  <div class="stack-sm" style="margin-bottom:12px">
    {#if backupNeeded}
      <div class="banner banner-warning">
        <AlertTriangle class="banner-icon" size={15} />
        <div class="grow">
          <strong>
            {app.settings?.lastBackupAt
              ? `Last backup: ${formatDate(app.settings.lastBackupAt.slice(0, 10), dateFormat)}`
              : 'No backup recorded yet'}
          </strong>
          <div class="tiny muted">
            Browser storage can be cleared by the browser or the operating system. Keep an export
            outside the browser.
          </div>
        </div>
        <Button size="sm" variant="secondary" onclick={() => void app.backupNow()}>
          <Download size={13} /> Back up now
        </Button>
      </div>
    {/if}
    {#if app.settings && !app.settings.storageWarningDismissed}
      <div class="banner banner-info">
        <div class="grow">
          <strong>This device is the only copy</strong>
          <div class="tiny muted">
            DocTrack has no server. Export a backup after you enter your leave and duty records.
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onclick={() => void app.perform((services) => services.markDismissed('storageWarningDismissed'))}
        >
          Dismiss
        </Button>
      </div>
    {/if}
  </div>
{/if}

<Card className="leave-usage-card">
  <div class="section-card-head">
    <div>
      <h2>Leave used and remaining</h2>
      <span class="tiny muted">Approved usage, pending approvals and upcoming holidays</span>
    </div>
    <button type="button" class="link-button tiny" onclick={() => navigate('/leave-rules')}>View rules</button>
  </div>

  <div class="leave-usage-table" role="table" aria-label="Leave usage, remaining balance and pending approvals">
    <div class="leave-usage-row leave-usage-head" role="row">
      <span role="columnheader">Leave</span>
      <span role="columnheader">Available</span>
      <span role="columnheader">Used</span>
      <span role="columnheader">Pending</span>
      <span role="columnheader">Used / remaining</span>
    </div>
    {#each leaveSummaries as leave (leave.code)}
      {@const total = Math.max(0, leave.available) + leave.used + leave.pending}
      <div class="leave-usage-row" role="row">
        <div class="leave-usage-name" role="cell">
          <span class={categoryChipClass(leave.code)}>{leave.label}</span>
          <span class="small muted">{leave.fullForm}</span>
        </div>
        <div class="leave-usage-value" role="cell">
          <span class="leave-usage-mobile-label">Available</span>
          <strong>{leaveNumber(leave.available)}</strong>
        </div>
        <div class="leave-usage-value" role="cell">
          <span class="leave-usage-mobile-label">Used</span>
          <strong>{leaveNumber(leave.used)}</strong>
        </div>
        <div class="leave-usage-value" role="cell">
          <span class="leave-usage-mobile-label">Pending</span>
          <strong>{leaveNumber(leave.pending)}</strong>
        </div>
        <div class="leave-usage-meter-cell" role="cell">
          <div
            class="leave-usage-meter"
            role="progressbar"
            aria-label={`${leave.code} leave usage`}
            aria-valuenow={leave.used}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuetext={`${daysText(leave.used)} used, ${daysText(leave.pending)} pending, ${daysText(leave.available)} remaining`}
          >
            <span class="leave-usage-used" style={`width:${percent(leave.used, total)}%`}></span>
            <span class="leave-usage-pending" style={`width:${percent(leave.pending, total)}%`}></span>
          </div>
        </div>
      </div>
    {/each}
  </div>
  <div class="leave-usage-key">
    <span><i class="leave-key-used"></i>Used</span>
    <span><i class="leave-key-pending"></i>Awaiting approval</span>
    <span><i class="leave-key-available"></i>Remaining</span>
  </div>

  <div class="leave-holiday-summary">
    <div class="leave-holiday-row">
      <span class="chip cat-gh">GH</span>
      <div>
        <strong>
          {holidayAvailability.gh} general holiday{holidayAvailability.gh === 1 ? '' : 's'} available
        </strong>
        <span class="tiny muted">Remaining until 31 Dec {holidayAvailability.year}</span>
      </div>
    </div>
    <div class="leave-holiday-row">
      <span class="chip cat-rh">RH</span>
      <div>
        <strong>
          {holidayAvailability.rh} valid RH date{holidayAvailability.rh === 1 ? '' : 's'} available
        </strong>
        <span class="tiny muted">
          Remaining until 31 Dec {holidayAvailability.year} · {leaveNumber(holidayAvailability.rhQuota)} RH entitlement available
        </span>
      </div>
    </div>
  </div>
</Card>

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:12px">
  <Card>
    <div class="section-card-head">
      <h2>This month</h2>
      <span class="tiny muted">{report?.required ?? 21} punches required</span>
    </div>
    {#if report}
      <div class="between" style="margin-bottom:5px">
        <span class="stat-value" style="font-size:1.2rem">{report.total} / {report.required}</span>
        <Badge tone={report.shortage ? 'warning' : 'success'}>
          {report.shortage ? `${report.missing} punch${report.missing === 1 ? '' : 'es'} short` : 'Requirement met'}
        </Badge>
      </div>
      <ProgressBar
        value={report.total}
        max={report.required}
        tone={report.shortage ? 'warning' : 'success'}
      />
      <div class="detail-grid" style="margin-top:9px">
        <div><dt>Confirmed</dt><dd>{report.confirmed}</dd></div>
        <div><dt>Assumed</dt><dd>{report.assumed}</dd></div>
        <div><dt>Leave days</dt><dd>{report.leaveDays}</dd></div>
        <div><dt>Excluded</dt><dd>{report.excludedSundays} Sun · {report.excludedHolidays} hol.</dd></div>
      </div>
      <p class="tiny muted" style="margin:7px 0 0">{report.projectionNote}</p>

      <div class="divider"></div>
      <div class="stack-sm">
        {#if todayLeave}
          <div class="row"><span class={categoryChipClass(todayLeave.category)}>{todayLeave.category}</span><span class="small">On leave today ({leaveStatusLabel(todayLeave.status)})</span></div>
        {/if}
        {#if todayDuty}
          <div class="row"><span class="chip cat-duty">Duty</span><span class="small">{todayDuty.shiftName} · {todayDuty.startTime}–{todayDuty.endTime}</span></div>
        {/if}
        {#if todayPdo}
          <div class="row"><span class="chip cat-pdo">PDO</span><span class="small">Post-duty off today</span></div>
        {/if}
        {#each todayEvents as event (event.id)}
          <div class="row"><span class="chip cat-event">Event</span><span class="small">{event.title}{#if event.startTime} · {event.startTime}{/if}</span></div>
        {/each}
        {#if !todayLeave && !todayDuty && !todayPdo && todayEvents.length === 0}
          <div class="tiny muted">No duty, leave or event recorded for today.</div>
        {/if}
      </div>
    {:else}
      <p class="tiny muted">No published policy is active, so attendance cannot be projected.</p>
    {/if}
    <div class="row" style="margin-top:8px">
      <Button size="sm" variant="secondary" onclick={() => navigate('/attendance')}>Open attendance</Button>
    </div>
  </Card>

  <Card>
    <div class="section-card-head">
      <h2>Suggested next steps</h2>
      <span class="tiny muted">Derived from your ledger</span>
    </div>
    {#if recommendations.length === 0}
      <p class="tiny muted">Nothing needs attention from the current ledger and calendar.</p>
    {:else}
      <div class="stack-sm">
        {#each recommendations.slice(0, 5) as recommendation (recommendation.id)}
          <div class="suggested">
            <div class="grow">
              <div class="row" style="gap:5px">
                <strong class="small">{recommendation.title}</strong>
                <Badge tone={recommendation.severity === 'warning' ? 'warning' : recommendation.severity === 'opportunity' ? 'info' : 'neutral'}>
                  {recommendation.severity}
                </Badge>
              </div>
              <p class="tiny muted" style="margin:2px 0 0">{recommendation.explanation}</p>
            </div>
            <button
              type="button"
              class="icon-btn"
              aria-label="Open suggestion"
              onclick={() => openRecommendation(recommendation)}
            >
              <ArrowRight size={15} />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </Card>
</div>

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:12px">
  <Card>
    <div class="section-card-head">
      <h2>Calendar</h2>
      <button type="button" class="link-button tiny" onclick={() => navigate('/planner')}>Plan a leave</button>
    </div>
    <CalendarMonth
      year={calYear}
      month={calMonth}
      weekStartsOn={app.settings?.weekStartsOn ?? 1}
      {marks}
      onPrev={() => shiftMonth(-1)}
      onNext={() => shiftMonth(1)}
      onSelect={() => navigate('/planner')}
    />
    <div class="legend" style="margin-top:8px">
      <span><i class="legend-dot cat-cl"></i>CL</span>
      <span><i class="legend-dot cat-el"></i>EL</span>
      <span><i class="legend-dot cat-ccl"></i>CCL</span>
      <span><i class="legend-dot cat-rh"></i>RH</span>
      <span><i class="legend-dot cat-duty"></i>Duty</span>
      <span><i class="legend-dot cat-pdo"></i>PDO</span>
      <span><i class="legend-dot cat-gh"></i>Holiday</span>
      <span><i class="legend-dot cat-event"></i>Event</span>
    </div>
  </Card>

  <Card>
    <div class="section-card-head">
      <h2>Coming up</h2>
      <button type="button" class="link-button tiny" onclick={() => navigate('/roster')}>Roster</button>
    </div>
    {#if upcoming.length === 0}
      <p class="tiny muted">No duties, leave, PDOs or events are recorded ahead.</p>
    {:else}
      <div class="stack-sm">
        {#each upcoming as item (item.date + item.title + item.badge)}
          <div class="list-row">
            <div class="list-date">
              <span>{SHORT_MONTH_NAMES[Number(item.date.slice(5, 7)) - 1]}</span>
              <strong>{Number(item.date.slice(8, 10))}</strong>
            </div>
            <span class="chip cat-{item.tone}">{item.badge}</span>
            <div class="list-main">
              <div class="list-title">{item.title}</div>
              <div class="tiny muted">{item.detail}</div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </Card>

  <Card>
    <div class="section-card-head">
      <h2>Recent ledger activity</h2>
      <button type="button" class="link-button tiny" onclick={() => navigate('/leave-rules')}>Rules</button>
    </div>
    {#if recentLedger.length === 0}
      <p class="tiny muted">The ledger is empty. Entitlement credits appear once your profile exists.</p>
    {:else}
      <div class="stack-sm">
        {#each recentLedger as transaction (transaction.id)}
          <div class="list-row">
            <span class={categoryChipClass(transaction.category)}>{transaction.category}</span>
            <div class="list-main">
              <div class="list-title">{transaction.reason}</div>
              <div class="tiny muted">
                {formatDate(transaction.effectiveDate, dateFormat)} · {transaction.source}
              </div>
            </div>
            <strong class="small" style="color:{transaction.direction === 'credit' ? 'var(--success)' : 'var(--danger)'}">
              {transaction.direction === 'credit' ? '+' : '−'}{transaction.amount}
            </strong>
          </div>
        {/each}
      </div>
    {/if}
    {#if shownBalances.length > 0}
      <p class="tiny muted" style="margin:9px 0 0">
        {daysText(shownBalances.find((balance) => balance.category === 'CL')?.available ?? 0)} CL available. Balances are rebuilt from the ledger every time this page opens.
      </p>
    {/if}
  </Card>
</div>
