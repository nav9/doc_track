<script lang="ts">
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import ProgressBar from '../lib/components/ui/ProgressBar.svelte';
  import CalendarMonth from '../lib/components/CalendarMonth.svelte';
  import { computeMonthAttendance } from '../lib/engines/attendance-engine/attendanceEngine';
  import { addMark, categoryChipClass, toneForCategory, type DayMark } from '../lib/app/ui';
  import { isActiveLeave } from '../lib/domain/leave/types';
  import { formatDate } from '../lib/domain/common/dates';

  const today = $derived(app.today);
  let year = $state(Number(app.today.slice(0, 4)));
  let month = $state(Number(app.today.slice(5, 7)));

  const policy = $derived(app.activePolicy);
  const report = $derived.by(() => {
    if (!policy) return null;
    return computeMonthAttendance({
      year,
      month,
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
    for (const day of report?.days ?? []) {
      if (day.leaveCategory) {
        addMark(map, day.date, day.leaveCategory, toneForCategory(day.leaveCategory));
      }
      if (day.status === 'confirmed') addMark(map, day.date, 'NMC', 'nmc');
      else if (day.status === 'assumed') addMark(map, day.date, 'NMC', 'nmc-assumed');
      else if (day.status === 'absent') continue;
      else if (day.status === 'leave' && !day.leaveCategory) addMark(map, day.date, 'Leave', 'leave');
      else if (day.status === 'holiday') addMark(map, day.date, 'Holiday', 'holiday');
    }
    return map;
  });

  const leavePunches = $derived.by(() => {
    const rows: { date: string; category: string; leaveStatus: string }[] = [];
    for (const record of app.snapshot.attendance) {
      if (record.state !== 'confirmed') continue;
      const leave = app.snapshot.leaves.find(
        (item) =>
          isActiveLeave(item) && record.date >= item.startDate && record.date <= item.endDate
      );
      if (leave) {
        rows.push({ date: record.date, category: leave.category, leaveStatus: leave.status });
      }
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  });

  function leaveOn(date: string) {
    return (
      app.snapshot.leaves.find(
        (leave) => isActiveLeave(leave) && date >= leave.startDate && date <= leave.endDate
      ) ?? null
    );
  }

  function shiftMonth(delta: number) {
    const total = year * 12 + (month - 1) + delta;
    year = Math.floor(total / 12);
    month = ((total % 12) + 12) % 12 + 1;
  }

  async function setPunch(date: string, state: 'confirmed' | 'absent') {
    await app.perform(
      (services) => services.setAttendance(date, state),
      state === 'confirmed' ? 'NMC punch recorded.' : 'NMC punch cleared.'
    );
  }

  async function togglePunch(date: string) {
    const day = report?.days.find((item) => item.date === date);
    if (!day) return;
    const hasPunch = day.status === 'confirmed' || day.status === 'assumed';
    if (hasPunch) {
      await setPunch(date, 'absent');
      return;
    }
    const leave = leaveOn(date);
    if (leave) {
      app.notify(
        'info',
        `NMC punch is not assumed on a ${leave.category} leave day. Remove the leave first if a punch is genuinely needed.`
      );
      return;
    }
    await setPunch(date, 'confirmed');
  }

  async function removeLeavePunch(date: string) {
    await app.perform(
      (services) => services.setAttendance(date, null),
      'NMC punch removed from this leave day.'
    );
  }
</script>

<PageHeader
  title="NMC attendance"
  subtitle={`${policy?.work.nmcRequiredPunchesPerMonth ?? 21} punches required each month. Sundays, general holidays, restricted holidays and leave days are not assumed.`}
>
  <Badge tone={report?.shortage ? 'warning' : 'success'}>
    {report?.shortage ? 'Shortage' : 'On track'}
  </Badge>
</PageHeader>

{#if report?.nmcSuspended}
  <div class="banner banner-warning" style="margin-bottom:12px">
    <div>
      <strong>NMC rule deactivated</strong>
      <div class="tiny">{report.nmcSuspensionReason}</div>
    </div>
  </div>
{/if}

<div class="grid-3" style="margin-bottom:12px">
  <Card>
    <div class="section-card-head"><h2>This month</h2><span class="tiny muted">{report?.required ?? 21} required</span></div>
    <div class="stat-value">{report?.total ?? 0} / {report?.required ?? 21}</div>
    <ProgressBar
      value={report?.total ?? 0}
      max={report?.required ?? 21}
      tone={report?.shortage ? 'warning' : 'success'}
      label="Punches counted"
    />
    <p class="tiny muted" style="margin:7px 0 0">{report?.projectionNote}</p>
  </Card>
  <Card>
    <div class="section-card-head"><h2>Confirmed</h2></div>
    <div class="stat-value">{report?.confirmed ?? 0}</div>
    <p class="tiny muted" style="margin:2px 0 0">Punches you explicitly marked or imported.</p>
    <div class="divider"></div>
    <div class="between small"><span>Assumed punches</span><strong>{report?.assumed ?? 0}</strong></div>
    <div class="between small"><span>Leave days</span><strong>{report?.leaveDays ?? 0}</strong></div>
    <div class="between small"><span>Sundays excluded</span><strong>{report?.excludedSundays ?? 0}</strong></div>
    <div class="between small"><span>Holidays excluded</span><strong>{report?.excludedHolidays ?? 0}</strong></div>
  </Card>
  <Card>
    <div class="section-card-head"><h2>How counting works</h2></div>
    <p class="tiny muted" style="margin:0">
      Only confirmed punches are verified attendance. Past working days without a record are
      shown as <em>assumed</em>, never as confirmed. Future days stay projected. A Sunday punch is
      allowed when it helps meet the monthly requirement. Punches are never assumed on confirmed
      leave, GH/RH, or during a maternity leave where NMC is deactivated.
    </p>
    <div class="legend" style="margin-top:8px">
      <span><i class="legend-dot cat-nmc"></i>NMC</span>
      <span><i class="legend-dot cat-nmc-assumed"></i>NMC punch (assumed)</span>
      <span><i class="legend-dot cat-holiday"></i>Sunday/holiday</span>
    </div>
  </Card>
</div>

{#if leavePunches.length > 0}
  <Card className="leave-punch-warning">
    <div class="section-card-head">
      <div>
        <h2>Punches recorded on leave days</h2>
        <span class="tiny muted">NMC is never assumed on leave. Remove any punch that should not be there.</span>
      </div>
      <Badge tone="warning">{leavePunches.length}</Badge>
    </div>
    <div class="stack-sm">
      {#each leavePunches as row (row.date)}
        <div class="list-row">
          <span class={categoryChipClass(row.category)}>{row.category}</span>
          <div class="list-main">
            <div class="list-title">{formatDate(row.date, app.settings?.dateFormat)}</div>
            <div class="tiny warning-text">This date is on {row.leaveStatus} leave but has a confirmed NMC punch.</div>
          </div>
          <Button size="sm" variant="danger" onclick={() => void removeLeavePunch(row.date)}>Remove NMC punch</Button>
        </div>
      {/each}
    </div>
  </Card>
{/if}

<Card>
  <div class="section-card-head"><h2>Month calendar</h2><span class="tiny muted">Tap a date to toggle its NMC punch</span></div>
  <CalendarMonth
    {year}
    {month}
    weekStartsOn={app.settings?.weekStartsOn ?? 1}
    {marks}
    onSelect={(date) => void togglePunch(date)}
    onPrev={() => shiftMonth(-1)}
    onNext={() => shiftMonth(1)}
  />
  <div class="legend" style="margin-top:8px">
    <span><i class="legend-dot cat-nmc"></i>NMC</span>
    <span><i class="legend-dot cat-nmc-assumed"></i>NMC punch (assumed)</span>
  </div>
</Card>
