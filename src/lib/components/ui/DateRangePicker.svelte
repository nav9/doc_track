<script lang="ts">
  import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from '@lucide/svelte';
  import { Popover, RangeCalendar, type DateRange } from 'bits-ui';
  import {
    getLocalTimeZone,
    parseDate,
    today,
    type CalendarDate
  } from '@internationalized/date';
  import { app } from '../../app/state.svelte';
  import { formatDate } from '../../domain/common/dates';

  let {
    label,
    start = $bindable(''),
    end = $bindable(''),
    hint = '',
    error = '',
    required = false,
    disabled = false,
    maxDays,
    minDate = '',
    maxDate = ''
  }: {
    label: string;
    start?: string;
    end?: string;
    hint?: string;
    error?: string;
    required?: boolean;
    disabled?: boolean;
    maxDays?: number;
    minDate?: string;
    maxDate?: string;
  } = $props();

  const triggerId = $props.id();
  const hintId = `${triggerId}-hint`;
  const errorId = `${triggerId}-error`;
  const placeholder = today(getLocalTimeZone());

  let open = $state(false);
  let range = $state<DateRange>(toRange(start, end));
  let lastExternalRange = `${start}|${end}`;

  function toDate(value: string): CalendarDate | undefined {
    if (!value) return undefined;
    try {
      return parseDate(value);
    } catch {
      return undefined;
    }
  }

  function toRange(startValue: string, endValue: string): DateRange {
    return { start: toDate(startValue), end: toDate(endValue) };
  }

  function iso(value: DateRange['start']): string {
    return value?.toString().slice(0, 10) ?? '';
  }

  $effect(() => {
    const next = `${start}|${end}`;
    if (next === lastExternalRange) return;
    lastExternalRange = next;
    range = toRange(start, end);
  });

  function handleValueChange(next: DateRange) {
    range = next;
    const nextStart = iso(next.start);
    const nextEnd = iso(next.end);
    lastExternalRange = `${nextStart}|${nextEnd}`;
    start = nextStart;
    end = nextEnd;
    if (nextStart && nextEnd) open = false;
  }

  const selectedLabel = $derived.by(() => {
    if (!start && !end) return 'Select dates';
    if (start && end) {
      return `${formatDate(start, app.settings?.dateFormat)} – ${formatDate(end, app.settings?.dateFormat)}`;
    }
    if (start) return `${formatDate(start, app.settings?.dateFormat)} – choose end`;
    return `Choose start – ${formatDate(end, app.settings?.dateFormat)}`;
  });

  const minValue = $derived(toDate(minDate));
  const maxValue = $derived(toDate(maxDate));
</script>

<div class="field date-range-field">
  <label class="field-label" for={triggerId}>
    {label}{#if required}<span class="req"> *</span>{/if}
  </label>

  <Popover.Root bind:open>
    <Popover.Trigger
      id={triggerId}
      class={`date-range-trigger${!start && !end ? ' is-empty' : ''}${error ? ' has-error' : ''}`}
      aria-label={`${label}${required ? ' (required)' : ''}: ${selectedLabel}`}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={error ? errorId : hint ? hintId : undefined}
      {disabled}
    >
      <CalendarDays size={14} />
      <span class="date-range-value">{selectedLabel}</span>
      <ChevronDown size={14} />
    </Popover.Trigger>

    <Popover.Content class="date-range-popover" align="start" sideOffset={6}>
      <RangeCalendar.Root
        value={range}
        onValueChange={handleValueChange}
        {placeholder}
        {minValue}
        {maxValue}
        {maxDays}
        preventDeselect
        weekStartsOn={app.settings?.weekStartsOn ?? 1}
        weekdayFormat="short"
        fixedWeeks
        numberOfMonths={2}
        calendarLabel={label}
        class="date-range-calendar"
      >
        {#snippet children({ months, weekdays })}
          <RangeCalendar.Header class="date-range-header">
            <RangeCalendar.PrevButton class="date-range-nav" aria-label="Previous month">
              <ChevronLeft size={15} />
            </RangeCalendar.PrevButton>
            <RangeCalendar.Heading class="date-range-heading" />
            <RangeCalendar.NextButton class="date-range-nav" aria-label="Next month">
              <ChevronRight size={15} />
            </RangeCalendar.NextButton>
          </RangeCalendar.Header>

          <div class="date-range-months">
            {#each months as month (month.value.toString())}
              <RangeCalendar.Grid class="date-range-grid">
                <RangeCalendar.GridHead>
                  <RangeCalendar.GridRow class="date-range-week">
                    {#each weekdays as weekday (weekday)}
                      <RangeCalendar.HeadCell class="date-range-dow">
                        {weekday.slice(0, 2)}
                      </RangeCalendar.HeadCell>
                    {/each}
                  </RangeCalendar.GridRow>
                </RangeCalendar.GridHead>
                <RangeCalendar.GridBody>
                  {#each month.weeks as week, weekIndex (weekIndex)}
                    <RangeCalendar.GridRow class="date-range-week">
                      {#each week as date, dayIndex (dayIndex)}
                        <RangeCalendar.Cell
                          {date}
                          month={month.value}
                          class="date-range-cell"
                        >
                          <RangeCalendar.Day class="date-range-day" />
                        </RangeCalendar.Cell>
                      {/each}
                    </RangeCalendar.GridRow>
                  {/each}
                </RangeCalendar.GridBody>
              </RangeCalendar.Grid>
            {/each}
          </div>
        {/snippet}
      </RangeCalendar.Root>
    </Popover.Content>
  </Popover.Root>

  {#if hint}<span class="field-hint" id={hintId}>{hint}</span>{/if}
  {#if error}<span class="field-error" id={errorId}>{error}</span>{/if}
</div>
