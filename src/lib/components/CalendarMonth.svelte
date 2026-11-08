<script lang="ts">
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';
  import {
    MONTH_NAMES,
    SHORT_DAY_NAMES,
    dayOfWeek,
    monthGrid,
    monthOf,
    todayLocal,
    yearOf
  } from '../domain/common/dates';
  import type { DayMark } from '../app/ui';

  let {
    year,
    month,
    weekStartsOn = 1,
    marks = {},
    selected = null,
    solidDates = [],
    suggestedDates = {},
    hideHeader = false,
    onSelect,
    onPrev,
    onNext,
    caption = ''
  }: {
    year: number;
    month: number;
    weekStartsOn?: 0 | 1;
    marks?: Record<string, DayMark[]>;
    selected?: string | null;
    solidDates?: string[];
    suggestedDates?: Record<string, string>;
    hideHeader?: boolean;
    onSelect?: (date: string) => void;
    onPrev?: () => void;
    onNext?: () => void;
    caption?: string;
  } = $props();

  const weeks = $derived(monthGrid(year, month, weekStartsOn));
  const today = $derived(todayLocal());
  const dayLabels = $derived(
    weekStartsOn === 1
      ? [...SHORT_DAY_NAMES.slice(1), SHORT_DAY_NAMES[0]]
      : [...SHORT_DAY_NAMES]
  );
</script>

<div class="cal">
  {#if !hideHeader}
  <div class="cal-head">
    {#if onPrev}
      <button type="button" class="icon-btn" aria-label="Previous month" onclick={onPrev}>
        <ChevronLeft size={16} />
      </button>
    {:else}<span class="icon-spacer"></span>{/if}
    <div class="cal-title">
      <strong>{MONTH_NAMES[month - 1]} {year}</strong>
      {#if caption}<span class="tiny muted">{caption}</span>{/if}
    </div>
    {#if onNext}
      <button type="button" class="icon-btn" aria-label="Next month" onclick={onNext}>
        <ChevronRight size={16} />
      </button>
    {:else}<span class="icon-spacer"></span>{/if}
  </div>
  {/if}

  <div class="cal-grid cal-dow">
    {#each dayLabels as label (label)}
      <div class="cal-dow-cell">{label}</div>
    {/each}
  </div>

  <div class="cal-grid">
    {#each weeks as week, weekIndex (weekIndex)}
      {#each week as date (date)}
        {@const outside = monthOf(date) !== month || yearOf(date) !== year}
        <button
          type="button"
          class="cal-cell"
          class:outside
          class:today={date === today}
          class:selected={date === selected}
          aria-label={date}
          onclick={() => onSelect?.(date)}
        >
          <span class="cal-day">{Number(date.slice(8, 10))}</span>
          <span class="cal-marks">
            {#if dayOfWeek(date) === 0}
              <span class="cal-mark cal-sunday" title="Sunday — weekly holiday">S</span>
            {/if}
            {#each (marks[date] ?? []).slice(0, 2) as mark (mark.label + mark.tone)}
              <span
                class="cal-mark cat-{mark.tone}"
                class:solid={mark.kind === 'leave' && solidDates.includes(date)}
                class:pending={mark.kind === 'leave-pending'}
                title={mark.label}
              >{mark.label}</span>
            {/each}
            {#if (marks[date]?.length ?? 0) > 2}
              <span class="cal-more">+{(marks[date]?.length ?? 0) - 2}</span>
            {/if}
            {#if suggestedDates[date]}
              <span class="cal-mark cal-suggested" title={suggestedDates[date]}>
                {suggestedDates[date]}
              </span>
            {/if}
          </span>
        </button>
      {/each}
    {/each}
  </div>
</div>
