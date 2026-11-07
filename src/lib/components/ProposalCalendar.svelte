<script lang="ts">
  import {
    MONTH_NAMES,
    SHORT_DAY_NAMES,
    addDays,
    dayOfWeek,
    formatDate,
    monthOf,
    todayLocal,
    yearOf
  } from '../domain/common/dates';
  import type { ISODate } from '../domain/common/types';
  import type { LeaveRequest } from '../domain/leave/types';
  import { isActiveLeave } from '../domain/leave/types';
  import { toneForCategory } from '../app/ui';

  let {
    startDate,
    endDate,
    category,
    leaves = [],
    weekStartsOn = 1
  }: {
    startDate: ISODate;
    endDate: ISODate;
    category: string;
    leaves?: LeaveRequest[];
    weekStartsOn?: 0 | 1;
  } = $props();

  const dayLabels = $derived(
    weekStartsOn === 1
      ? [...SHORT_DAY_NAMES.slice(1), SHORT_DAY_NAMES[0]]
      : [...SHORT_DAY_NAMES]
  );
  const today = $derived(todayLocal());

  function monthLabel(start: ISODate, end: ISODate): string {
    const startMonth = MONTH_NAMES[monthOf(start) - 1];
    const endMonth = MONTH_NAMES[monthOf(end) - 1];
    const startYear = yearOf(start);
    const endYear = yearOf(end);
    if (start.slice(0, 7) === end.slice(0, 7)) return `${startMonth} ${startYear}`;
    if (startYear === endYear) return `${startMonth} – ${endMonth} ${endYear}`;
    return `${startMonth} ${startYear} – ${endMonth} ${endYear}`;
  }

  const title = $derived(monthLabel(startDate, endDate));

  // Render only the complete weeks touched by the proposal. Partial weeks give
  // the dates context without forcing a whole month into every result card.
  const weeks = $derived.by(() => {
    const startOffset = (dayOfWeek(startDate) - weekStartsOn + 7) % 7;
    const endOffset = 6 - ((dayOfWeek(endDate) - weekStartsOn + 7) % 7);
    const first = addDays(startDate, -startOffset);
    const last = addDays(endDate, endOffset);
    const result: ISODate[][] = [];
    let cursor = first;
    while (cursor <= last && result.length < 10) {
      const week: ISODate[] = [];
      for (let index = 0; index < 7; index += 1) week.push(addDays(cursor, index));
      result.push(week);
      cursor = addDays(cursor, 7);
    }
    return result;
  });

  const leavesByDate = $derived.by(() => {
    const map = new Map<ISODate, LeaveRequest[]>();
    for (const leave of leaves) {
      if (!isActiveLeave(leave)) continue;
      let cursor = leave.startDate;
      while (cursor <= leave.endDate) {
        const list = map.get(cursor) ?? [];
        list.push(leave);
        map.set(cursor, list);
        cursor = addDays(cursor, 1);
      }
    }
    return map;
  });
</script>

<div class="proposal-cal" role="group" aria-label={`${category} proposal calendar for ${title}`}>
  <div class="proposal-cal-head">
    <div class="proposal-cal-title">
      <strong>{title}</strong>
      <span class="tiny muted">Only the weeks containing this proposal are shown.</span>
    </div>
    <div class="proposal-legend" aria-label="Calendar legend">
      <span><i class="proposal-key proposal-key-confirmed"></i>Recorded leave</span>
      <span><i class="proposal-key proposal-key-proposed"></i>Proposal</span>
    </div>
  </div>

  <div class="proposal-grid proposal-dow" role="row">
    {#each dayLabels as label, index (label)}
      <div class="proposal-dow-cell" role="columnheader" title={SHORT_DAY_NAMES[(index + weekStartsOn) % 7]}>
        {label}
      </div>
    {/each}
  </div>

  <div class="proposal-weeks" role="grid">
    {#each weeks as week, weekIndex (week[0])}
      <div class="proposal-grid proposal-week" role="row">
        {#each week as date (date)}
          {@const proposed = date >= startDate && date <= endDate}
          {@const confirmed = leavesByDate.get(date) ?? []}
          <div
            class="proposal-cell"
            class:proposed-day={proposed}
            class:today={date === today}
            role="gridcell"
            aria-label={`${formatDate(date)}${proposed ? `, ${category} proposal` : ''}${confirmed.length ? `, recorded ${confirmed.map((leave) => leave.category).join(', ')}` : ''}`}
            title={formatDate(date)}
          >
            <span class="proposal-day">{Number(date.slice(8, 10))}</span>
            <div class="proposal-marks">
              {#each confirmed as leave (leave.id)}
                <span
                  class="leave-cal-chip confirmed cat-{toneForCategory(leave.category)}"
                  title={`${leave.category} leave`}
                >{leave.category}</span>
              {/each}
              {#if proposed}
                <span
                  class="leave-cal-chip proposed cat-{toneForCategory(category)}"
                  title={`${category} proposal`}
                >{category}</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>