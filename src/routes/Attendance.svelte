<script lang="ts">
  import { app } from '../lib/app/state.svelte';
  import PageHeader from '../lib/components/ui/PageHeader.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Badge from '../lib/components/ui/Badge.svelte';
  import ProgressBar from '../lib/components/ui/ProgressBar.svelte';
  import Dialog from '../lib/components/ui/Dialog.svelte';
  import CalendarMonth from '../lib/components/CalendarMonth.svelte';
  import { computeMonthAttendance } from '../lib/engines/attendance-engine/attendanceEngine';
  import { attendanceStatusLabel } from '../lib/domain/attendance/types';
  import { SHORT_MONTH_NAMES, formatDate } from '../lib/domain/common/dates';
  import { addMark, toneForCategory, type DayMark } from '../lib/app/ui';

  const today = $derived(app.today);
  let year = $state(Number(app.today.slice(0, 4)));
  let month = $state(Number(app.today.slice(5, 7)));
  let selectedDate = $state<string | null>(null);
  let dialogOpen = $state(false);

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
      if (day.status === 'confirmed') addMark(map, day.date, 'Punch', 'nmc');
      else if (day.status === 'assumed') addMark(map, day.date, 'A', 'duty');
      else if (day.status === 'absent') addMark(map, day.date, 'Absent', 'lop');
      else if (day.status === 'leave') addMark(map, day.date, day.leaveCategory ?? 'Leave', toneForCategory(day.leaveCategory ?? 'CL'));
      else if (day.status === 'holiday') addMark(map, day.date, 'Holiday', 'holiday');
    }
    return map;
  });

  const selectedDay = $derived(
    report?.days.find((day) => day.date === selectedDate) ?? null
  );

  const recentDays = $derived(
    (report?.days ?? [])
      .filter((day) => ['confirmed', 'assumed', 'absent', 'leave'].includes(day.status) && day.date <= today)
      .slice(-8)
      .reverse()
  );

  function shiftMonth(delta: number) {
    const total = year * 12 + (month - 1) + delta;
    year = Math.floor(total / 12);
    month = ((total % 12) + 12) % 12 + 1;
  }

  function openDay(date: string) {
    selectedDate = date;
    dialogOpen = true;
  }

  async function mark(state: 'confirmed' | 'absent') {
    if (!selectedDate) return;
    await app.perform(
      (services) => services.setAttendance(selectedDate as string, state),
      state === 'confirmed' ? 'Punch confirmed.' : 'Day marked as not punched.'
    );
    dialogOpen = false;
  }

  async function clearDay() {
    if (!selectedDate) return;
    await app.perform((services) => services.setAttendance(selectedDate as string, null), 'Punch cleared.');
    dialogOpen = false;
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
      <span><i class="legend-dot cat-nmc"></i>Confirmed</span>
      <span><i class="legend-dot cat-duty"></i>Assumed</span>
      <span><i class="legend-dot cat-lop"></i>Absent</span>
      <span><i class="legend-dot cat-holiday"></i>Sunday/holiday</span>
    </div>
  </Card>
</div>

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:12px">
  <Card>
    <div class="section-card-head"><h2>Month calendar</h2><span class="tiny muted">Tap a date to mark it</span></div>
    <CalendarMonth
      {year}
      {month}
      weekStartsOn={app.settings?.weekStartsOn ?? 1}
      {marks}
      selected={selectedDate}
      onSelect={openDay}
      onPrev={() => shiftMonth(-1)}
      onNext={() => shiftMonth(1)}
    />
    <div class="legend" style="margin-top:8px">
      <span><i class="legend-dot cat-nmc"></i>Confirmed punch</span>
      <span><i class="legend-dot cat-duty"></i>Assumed punch</span>
      <span><i class="legend-dot cat-lop"></i>Absent</span>
    </div>
  </Card>

  <Card>
    <div class="section-card-head"><h2>Recent working days</h2></div>
    {#if recentDays.length === 0}
      <p class="tiny muted">No working days recorded in this month yet.</p>
    {:else}
      <div class="stack-sm">
        {#each recentDays as day (day.date)}
          <div class="list-row">
            <div class="list-date"><span>{SHORT_MONTH_NAMES[Number(day.date.slice(5, 7)) - 1]}</span><strong>{Number(day.date.slice(8, 10))}</strong></div>
            <div class="list-main">
              <div class="list-title">{formatDate(day.date, app.settings?.dateFormat)}</div>
              <div class="tiny muted">{attendanceStatusLabel(day.status)}</div>
            </div>
            <div class="row" style="gap:3px">
              <Button size="sm" variant="secondary" onclick={() => { selectedDate = day.date; void mark('confirmed'); }}>Punch</Button>
              <Button size="sm" variant="ghost" onclick={() => { selectedDate = day.date; void mark('absent'); }}>Absent</Button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
    <p class="tiny muted" style="margin:8px 0 0">
      Marking a day changes only your local record. Use the import feature to bring in official
      attendance data if you have it.
    </p>
  </Card>
</div>

<Dialog
  open={dialogOpen}
  title={selectedDate ? formatDate(selectedDate, app.settings?.dateFormat) : 'Attendance'}
  subtitle={selectedDay ? attendanceStatusLabel(selectedDay.status) : ''}
  onclose={() => (dialogOpen = false)}
>
  {#if selectedDay}
    <dl class="detail-grid">
      <div><dt>Status</dt><dd>{attendanceStatusLabel(selectedDay.status)}</dd></div>
      <div><dt>Counts</dt><dd>{selectedDay.counts ? '1 punch' : 'No punch'}</dd></div>
      {#if selectedDay.leaveCategory}<div><dt>Leave</dt><dd>{selectedDay.leaveCategory}</dd></div>{/if}
      <div><dt>Note</dt><dd>{selectedDay.note}</dd></div>
    </dl>
  {:else}
    <p class="tiny muted">This date is outside the loaded month.</p>
  {/if}
  <div class="row" style="margin-top:10px">
    <Button size="sm" onclick={() => void mark('confirmed')}>Mark as punched</Button>
    <Button size="sm" variant="secondary" onclick={() => void mark('absent')}>Mark as not punched</Button>
    <Button size="sm" variant="ghost" onclick={() => void clearDay()}>Clear record</Button>
  </div>
  <p class="tiny muted" style="margin:8px 0 0">
    Sunday punches are allowed. Leave and holiday days are excluded from the monthly total.
  </p>
</Dialog>
