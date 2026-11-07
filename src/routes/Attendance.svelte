<script lang="ts">
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import ProgressBar from '../lib/components/ui/ProgressBar.svelte';
  import CalendarMonth from '../lib/components/CalendarMonth.svelte';
  import { computeMonthAttendance } from '../lib/engines/attendance-engine/attendanceEngine';
  import { addMark, toneForCategory, type DayMark } from '../lib/app/ui';

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
      if (day.status === 'confirmed') addMark(map, day.date, 'NMC', 'nmc');
      else if (day.status === 'assumed') addMark(map, day.date, 'NMC punch', 'nmc-assumed');
      else if (day.status === 'absent') continue;
      else if (day.status === 'leave') addMark(map, day.date, day.leaveCategory ?? 'Leave', toneForCategory(day.leaveCategory ?? 'CL'));
      else if (day.status === 'holiday') addMark(map, day.date, 'Holiday', 'holiday');
    }
    return map;
  });

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
    await setPunch(date, hasPunch ? 'absent' : 'confirmed');
  }
</script>

<PageHeader
  title="NMC attendance"
  subtitle={`${policy?.work.nmcRequiredPunchesPerMonth ?? 21} punches required each month. Sundays and general holidays are excluded.`}
>
  <Badge tone={report?.shortage ? 'warning' : 'success'}>
    {report?.shortage ? 'Shortage' : 'On track'}
  </Badge>
</PageHeader>

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
      allowed when it helps meet the monthly requirement.
    </p>
    <div class="legend" style="margin-top:8px">
      <span><i class="legend-dot cat-nmc"></i>NMC</span>
      <span><i class="legend-dot cat-nmc-assumed"></i>NMC punch (assumed)</span>
      <span><i class="legend-dot cat-holiday"></i>Sunday/holiday</span>
    </div>
  </Card>
</div>

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
