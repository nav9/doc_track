<script lang="ts">
  import {
    CalendarDays,
    Check,
    ChevronDown,
    ChevronRight,
    ClipboardCopy,
    X
  } from '@lucide/svelte';
  import { app } from '../lib/app/state.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import Dialog from '../lib/components/ui/Dialog.svelte';
  import Select from '../lib/components/ui/Select.svelte';
  import Toggle from '../lib/components/ui/Toggle.svelte';
  import {
    evaluateLeaveRequest,
    type LeaveEvaluation,
    type LeaveValidationContext
  } from '../lib/engines/leave-validation/leaveValidation';
  import { rhPeriodFor } from '../lib/engines/policy-engine/policyEngine';
  import {
    contiguousRuns,
    doctorMatches,
    monthRows,
    plannerMonths
  } from '../lib/engines/planning-engine/plannerTools';
  import {
    MONTH_NAMES,
    addDays,
    dayOfWeek,
    eachDate,
    formatDate,
    formatDateTime,
    isWeekend,
    monthKey,
    rangeLength
  } from '../lib/domain/common/dates';
  import { isActiveLeave, leaveStatusLabel, type LeaveRequest } from '../lib/domain/leave/types';
  import { isSharedLeaveActive } from '../lib/domain/multiuser/types';
  import { categoryChipClass, rangeText, toneForCategory } from '../lib/app/ui';
  import { messageOf } from '../lib/application/services/errors';

  const INTRO =
    'Click a leave type and tap on a date or swipe on multiple dates to indicate which dates you plan to take leave. Tap or swipe again to un-select. The algorithm might show you some suggestions too. Then click the "Apply for leave" button to confirm.';

  interface PlannerChip {
    label: string;
    tone: string;
    kind: 'holiday' | 'leave' | 'leave-pending' | 'duty' | 'pdo' | 'event';
    leaveId?: string;
    pdoId?: string;
    title?: string;
  }

  interface CalendarLeave {
    id: string;
    category: string;
    startDate: string;
    endDate: string;
    calendarDays: number;
    leaveDays: number;
    status: LeaveRequest['status'];
    purpose: string;
    coveringDoctor: string;
    appliedAt: string;
    decisionAt: string;
    source: 'ledger' | 'application';
  }

  interface HistoryItem extends CalendarLeave {}

  interface ConfirmChunk {
    startDate: string;
    endDate: string;
    purpose: string;
    coveringDoctor: string;
  }

  interface SelectionIssue {
    severity: 'error' | 'warning' | 'condition' | 'info';
    message: string;
  }

  const today = $derived(app.today);
  const policy = $derived(app.activePolicy);
  const profile = $derived(app.profile);
  const employment = $derived(app.employment);
  const weekendDays = $derived(policy?.work.weekendDays ?? [0, 6]);
  const categories = $derived(policy?.categories.filter((category) => category.enabled) ?? []);
  const categoryMap = $derived(new Map(categories.map((category) => [category.code, category])));
  const ownName = $derived(
    profile ? `${profile.prefix} ${profile.name}`.replace(/\s+/g, ' ').trim() : ''
  );

  let calendarYear = $state(Number(app.today.slice(0, 4)));
  let barOpen = $state(true);
  let moreOpen = $state(false);
  let activeCategory = $state<string | null>(null);
  let selectedDates = $state<string[]>([]);
  let dragAdd = $state<boolean | null>(null);
  let focusDate = $state('');
  let context = $state<LeaveValidationContext | null>(null);
  let calendarScroll = $state<HTMLElement | null>(null);
  let initialScrollDone = false;

  let ledgerOpen = $state(false);
  let confirmOpen = $state(false);
  let actionOpen = $state(false);
  let confirming = $state(false);
  let confirmed = $state(false);
  let copyText = $state('');
  let confirmChunks = $state<ConfirmChunk[]>([]);
  let actionDate = $state('');
  let actionLeaveId = $state('');
  let actionPdoId = $state('');
  let editingLeaveId = $state('');
  let actionRetroCategory = $state('CL');
  let actionTargetDate = $state(app.today);

  let filterActive = $state(true);
  let filterYear = $state('');
  let filterMonth = $state('');
  let filterType = $state('');
  let historyScrollTop = $state(0);

  const baseTypes = [
    { code: 'CL', label: 'CL' },
    { code: 'EL', label: 'EL' },
    { code: 'CCL', label: 'CCL' },
    { code: 'SPCL', label: 'SpCL' },
    { code: 'RH', label: 'RH' }
  ];

  function shortLabel(code: string): string {
    return code === 'SPCL' ? 'SpCL' : code;
  }

  function round(value: number): number {
    return Math.round(value * 10) / 10;
  }

  function typeCountText(code: string): string {
    if (code === 'LOP') return 'LOP';
    const value = availability[code] ?? 0;
    return `${round(value)} ${shortLabel(code)}`;
  }

  $effect(() => {
    app.snapshot;
    app.settings;
    app.activePolicy;
    if (!app.services) return;
    let cancelled = false;
    void app.services
      .leaveContext()
      .then((result) => {
        if (!cancelled) context = result.context;
      })
      .catch(() => {
        if (!cancelled) context = null;
      });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (!selectedDates.length) dragAdd = null;
  });

  $effect(() => {
    calendarDates;
    if (initialScrollDone) return;
    initialScrollDone = true;
    const currentMonth = today.slice(0, 7);
    window.setTimeout(() => {
      const month = calendarScroll?.querySelector<HTMLElement>(
        `[data-planner-month="${currentMonth}"]`
      );
      if (month && calendarScroll) {
        calendarScroll.scrollTop = month.offsetTop - calendarScroll.offsetTop;
      }
    }, 90);
  });

  const ownLeaves = $derived(app.snapshot.leaves);
  const sharedSelf = $derived(
    app.snapshot.sharedLeaves.filter(
      (leave) =>
        isSharedLeaveActive(leave) &&
        (leave.employeeId.trim().toLowerCase() === (profile?.employeeId ?? '').trim().toLowerCase() ||
          leave.doctorName.trim().toLowerCase() === ownName.toLowerCase())
    )
  );

  const leavesForCalendar = $derived.by<CalendarLeave[]>(() => [
    ...ownLeaves
      .filter((leave) => isActiveLeave(leave))
      .map((leave) => ({
        id: leave.id,
        category: leave.category,
        startDate: leave.startDate,
        endDate: leave.endDate,
        calendarDays: leave.calendarDays,
        leaveDays: leave.leaveDays,
        status: leave.status,
        purpose: leave.purpose ?? leave.reason,
        coveringDoctor: leave.coveringDoctor ?? '',
        appliedAt: leave.createdAt,
        decisionAt:
          leave.status === 'approved' || leave.status === 'rejected' ? leave.updatedAt : '',
        source: 'ledger' as const
      })),
    ...sharedSelf.map((leave) => ({
      id: leave.id,
      category: leave.category,
      startDate: leave.startDate,
      endDate: leave.endDate,
      calendarDays: rangeLength(leave.startDate, leave.endDate),
      leaveDays: rangeLength(leave.startDate, leave.endDate),
      status: leave.status,
      purpose: leave.purpose ?? leave.reason,
      coveringDoctor: leave.coveringDoctor ?? '',
      appliedAt: leave.createdAt,
      decisionAt:
        leave.status === 'approved' || leave.status === 'rejected' ? leave.updatedAt : '',
      source: 'application' as const
    }))
  ]);

  const historyItems = $derived(
    leavesForCalendar
      .slice()
      .sort(
        (a, b) =>
          b.appliedAt.localeCompare(a.appliedAt) || b.startDate.localeCompare(a.startDate)
      )
  );

  const monthLabels = $derived(plannerMonths(calendarYear));
  const calendarStart = $derived(`${calendarYear}-01-01`);
  const calendarEnd = $derived(`${calendarYear + 1}-03-31`);
  const calendarDates = $derived(eachDate(calendarStart, calendarEnd));

  const holidayByDate = $derived.by(() => {
    const map: Record<string, { kind: string; name: string }[]> = {};
    for (const holiday of app.snapshot.holidays) {
      if (holiday.date < calendarStart || holiday.date > calendarEnd) continue;
      map[holiday.date] = [...(map[holiday.date] ?? []), { kind: holiday.kind, name: holiday.name }];
    }
    return map;
  });

  const dutyByDate = $derived.by(() => {
    const map: Record<string, { id: string; status: string }> = {};
    for (const duty of app.snapshot.duties) {
      if (duty.status === 'cancelled' || duty.date < calendarStart || duty.date > calendarEnd) continue;
      map[duty.date] = { id: duty.id, status: duty.status };
    }
    return map;
  });

  const pdoByDate = $derived.by(() => {
    const map: Record<string, { id: string | null; date: string }> = {};
    for (const pdo of app.snapshot.pdos) {
      if (pdo.status !== 'scheduled' || pdo.date < calendarStart || pdo.date > calendarEnd) continue;
      map[pdo.date] = { id: pdo.id, date: pdo.date };
    }
    for (const duty of app.snapshot.duties) {
      if (duty.status === 'cancelled') continue;
      const pdoDate = addDays(duty.date, 1);
      if (pdoDate < calendarStart || pdoDate > calendarEnd) continue;
      if (!map[pdoDate]) map[pdoDate] = { id: null, date: pdoDate };
    }
    return map;
  });

  const eventByDate = $derived.by(() => {
    const map: Record<string, { title: string; type: string }[]> = {};
    for (const event of app.snapshot.events) {
      const end = event.endDate ?? event.date;
      if (end < calendarStart || event.date > calendarEnd) continue;
      const from = event.date < calendarStart ? calendarStart : event.date;
      const to = end > calendarEnd ? calendarEnd : end;
      for (const date of eachDate(from, to)) {
        map[date] = [...(map[date] ?? []), { title: event.title, type: event.type }];
      }
    }
    return map;
  });

  const chipsByDate = $derived.by(() => {
    const map: Record<string, PlannerChip[]> = {};
    const add = (date: string, chip: PlannerChip) => {
      const list = map[date] ?? [];
      if (!list.some((item) => item.label === chip.label && item.kind === chip.kind && item.leaveId === chip.leaveId && item.pdoId === chip.pdoId)) {
        list.push(chip);
      }
      map[date] = list;
    };

    for (const [date, holidays] of Object.entries(holidayByDate)) {
      for (const holiday of holidays) {
        add(date, {
          label: holiday.kind,
          tone: holiday.kind === 'GH' ? 'gh' : 'rh',
          kind: 'holiday',
          title: holiday.name
        });
      }
    }

    for (const leave of leavesForCalendar) {
      for (const date of eachDate(leave.startDate, leave.endDate)) {
        if (date < calendarStart || date > calendarEnd) continue;
        add(date, {
          label: leave.category,
          tone: toneForCategory(leave.category),
          kind: leave.status === 'approved' ? 'leave' : 'leave-pending',
          leaveId: leave.id,
          title: `${leave.category} · ${leaveStatusLabel(leave.status)}`
        });
      }
    }

    for (const [date, duty] of Object.entries(dutyByDate)) {
      add(date, { label: 'Duty', tone: 'duty', kind: 'duty', title: `Duty · ${duty.status}` });
    }

    for (const [date, pdo] of Object.entries(pdoByDate)) {
      add(date, { label: 'PDO', tone: 'pdo', kind: 'pdo', pdoId: pdo.id ?? undefined, title: 'Post-duty off' });
    }

    for (const [date, events] of Object.entries(eventByDate)) {
      for (const event of events) {
        add(date, { label: event.title, tone: 'event', kind: 'event', title: event.title });
      }
    }
    return map;
  });

  const leaveDates = $derived(
    new Set(leavesForCalendar.flatMap((leave) => eachDate(leave.startDate, leave.endDate)))
  );

  const rhRemaining = $derived.by(() => {
    if (!employment?.startDate) return 0;
    const rule = categoryMap.get('RH');
    if (!rule) return 0;
    const period = rhPeriodFor(employment.startDate, today);
    if (!period) return 0;
    const used = leavesForCalendar.filter(
      (leave) =>
        leave.category === 'RH' &&
        leave.startDate >= period.start &&
        leave.startDate <= period.end &&
        leave.status !== 'rejected' &&
        leave.status !== 'cancelled'
    ).length;
    return Math.max(0, (rule.entitlement.amount ?? 1) - used);
  });

  const availability = $derived.by<Record<string, number>>(() => {
    const result: Record<string, number> = {};
    for (const category of categories) {
      if (category.code === 'LOP') {
        result[category.code] = Number.POSITIVE_INFINITY;
      } else if (category.code === 'RH') {
        result[category.code] = rhRemaining;
      } else if (category.entitlement.unit === 'months') {
        result[category.code] = 0;
      } else {
        result[category.code] = Math.max(0, app.balances[category.code]?.available ?? 0);
      }
    }
    return result;
  });

  const moreTypes = $derived(
    categories.filter(
      (category) =>
        !baseTypes.some((type) => type.code === category.code) &&
        !['GH', 'LOP'].includes(category.code)
    )
  );
  const lopType = $derived(categoryMap.get('LOP') ?? null);

  const selectedRule = $derived(activeCategory ? categoryMap.get(activeCategory) ?? null : null);
  const selectedSet = $derived(new Set(selectedDates));
  const selectedRuns = $derived(contiguousRuns(selectedDates));
  const editingLeave = $derived(
    editingLeaveId ? leavesForCalendar.find((leave) => leave.id === editingLeaveId) ?? null : null
  );

  const eligibilityContext = $derived(
    context
      ? { ...context, balances: app.balances, skipAttendanceImpact: true }
      : null
  );

  const eligibilityMap = $derived.by<Record<string, boolean>>(() => {
    const result: Record<string, boolean> = {};
    if (!activeCategory || !eligibilityContext) return result;
    const rule = selectedRule;
    if (!rule) return result;

    for (const date of calendarDates) {
      if (dayOfWeek(date) === 0) continue;
      if (dutyByDate[date] || pdoByDate[date] || leaveDates.has(date)) continue;
      const holidays = holidayByDate[date] ?? [];
      if (holidays.length > 0) {
        if (activeCategory !== 'RH' || !holidays.some((holiday) => holiday.kind === 'RH')) continue;
      }
      if (activeCategory === 'RH' && !holidays.some((holiday) => holiday.kind === 'RH')) continue;
      if (activeCategory === 'LOP' && (isWeekend(date, weekendDays) || holidays.length > 0)) continue;
      if (rule.counting === 'working-days' && isWeekend(date, weekendDays)) continue;
      if (employment) {
        if (date < employment.startDate) continue;
        if (employment.endDate && date > employment.endDate) continue;
      }

      try {
        const evaluation = evaluateLeaveRequest(
          { category: activeCategory, startDate: date, endDate: date },
          eligibilityContext
        );
        const errors = evaluation.reasons.filter(
          (reason) =>
            reason.severity === 'error' &&
            !(activeCategory === 'EL' && reason.code === 'BELOW_MINIMUM')
        );
        if (errors.length === 0) result[date] = true;
      } catch {
        // A date that cannot be evaluated is not selectable.
      }
    }
    return result;
  });

  const suggestedByDate = $derived.by<Record<string, string>>(() => {
    const result: Record<string, string> = {};
    if (!activeCategory || selectedDates.length === 0) return result;
    const first = selectedDates[0];
    const last = selectedDates[selectedDates.length - 1];
    const windowStart = addDays(first, -7);
    const windowEnd = addDays(last, 7);

    const off = new Set<string>();
    for (const date of calendarDates) {
      if (dayOfWeek(date) === 0) off.add(date);
      if (holidayByDate[date]?.length) off.add(date);
      if (pdoByDate[date]) off.add(date);
      if (leaveDates.has(date)) off.add(date);
    }
    for (const date of selectedDates) off.add(date);

    for (const date of calendarDates) {
      if (date < windowStart || date > windowEnd) continue;
      if (!eligibilityMap[date] || off.has(date)) continue;
      let before = 0;
      let cursor = addDays(date, -1);
      while (before < 4 && off.has(cursor)) {
        before += 1;
        cursor = addDays(cursor, -1);
      }
      let after = 0;
      cursor = addDays(date, 1);
      while (after < 4 && off.has(cursor)) {
        after += 1;
        cursor = addDays(cursor, 1);
      }
      if (before + after >= 2) result[date] = activeCategory;
    }
    return result;
  });

  const selectionEvaluations = $derived.by(() => {
    const category = activeCategory;
    const ctx = context;
    if (!ctx || !category || selectedRuns.length === 0) return [];
    return selectedRuns.map((run) => {
      try {
        return evaluateLeaveRequest(
          {
            category,
            startDate: run[0],
            endDate: run[run.length - 1]
          },
          { ...ctx, balances: app.balances, excludeLeaveId: editingLeaveId || null }
        );
      } catch {
        return null;
      }
    });
  });

  const selectionIssues = $derived.by<SelectionIssue[]>(() => {
    const issues: SelectionIssue[] = [];
    for (const evaluation of selectionEvaluations) {
      if (!evaluation) continue;
      for (const reason of evaluation.reasons) {
        if (reason.severity === 'info') continue;
        if (!issues.some((issue) => issue.message === reason.message)) {
          issues.push({ severity: reason.severity, message: reason.message });
        }
      }
    }
    if (activeCategory && activeCategory !== 'LOP') {
      const restored = editingLeave?.category === activeCategory ? editingLeave.leaveDays : 0;
      const effective = (availability[activeCategory] ?? 0) + restored;
      if (selectedDates.length > effective) {
        issues.unshift({
          severity: 'error',
          message: `Only ${round(effective)} ${shortLabel(activeCategory)} day(s) are available for this selection.`
        });
      }
    }

    if (activeCategory && selectedRule?.maxDaysPerMonth !== null && selectedRule) {
      const existing = new Map<string, number>();
      for (const leave of leavesForCalendar) {
        if (
          leave.category !== activeCategory ||
          leave.status === 'rejected' ||
          leave.status === 'cancelled' ||
          leave.id === editingLeaveId
        ) continue;
        for (const date of eachDate(leave.startDate, leave.endDate)) {
          const key = monthKey(date);
          existing.set(key, (existing.get(key) ?? 0) + 1);
        }
      }
      const selectedByMonth = new Map<string, number>();
      for (const date of selectedDates) {
        const key = monthKey(date);
        selectedByMonth.set(key, (selectedByMonth.get(key) ?? 0) + 1);
      }
      for (const [key, count] of selectedByMonth) {
        const total = (existing.get(key) ?? 0) + count;
        if (total > selectedRule.maxDaysPerMonth) {
          issues.unshift({
            severity: 'error',
            message: `${total} ${shortLabel(activeCategory)} days in ${key}, above the monthly limit of ${selectedRule.maxDaysPerMonth}.`
          });
        }
      }
    }
    return issues;
  });

  const canOpenConfirm = $derived(selectedDates.length > 0);

  const doctorNames = $derived(
    [
      ...app.snapshot.doctors.map((doctor) => doctor.name),
      ...app.snapshot.rosters.flatMap((roster) => roster.entries.map((entry) => entry.doctorName)),
      ownName
    ]
      .map((name) => name.trim())
      .filter(Boolean)
  );

  const ledgerRows = $derived.by(() =>
    categories
      .filter((category) => category.code !== 'GH')
      .map((category) => {
        const leaves = historyItems.filter((leave) => leave.category === category.code);
        const used = leaves
          .filter((leave) => leave.status === 'approved')
          .reduce((sum, leave) => sum + leave.leaveDays, 0);
        const pending = leaves
          .filter((leave) => leave.status === 'pending' || leave.status === 'planned')
          .reduce((sum, leave) => sum + leave.leaveDays, 0);
        return {
          code: category.code,
          label: shortLabel(category.code),
          fullForm: category.fullForm,
          remaining: category.code === 'LOP' ? Number.POSITIVE_INFINITY : availability[category.code] ?? 0,
          used: round(used),
          pending: round(pending),
          applied: round(used + pending)
        };
      })
  );

  const historyYears = $derived(
    [
      ...new Set([
        String(calendarYear),
        String(calendarYear + 1),
        ...historyItems.map((leave) => leave.startDate.slice(0, 4))
      ])
    ].sort()
  );
  const historyTypes = $derived(
    [...new Set(historyItems.map((leave) => leave.category))].sort()
  );

  function leaveTouchesMonth(leave: HistoryItem, year: number, month: number): boolean {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    return monthKey(leave.startDate) <= key && monthKey(leave.endDate) >= key;
  }

  const filteredHistory = $derived.by(() => {
    if (!filterActive) return historyItems;
    return historyItems.filter((leave) => {
      if (filterYear && leave.startDate.slice(0, 4) !== filterYear) return false;
      if (filterMonth && !leaveTouchesMonth(leave, Number(filterYear || calendarYear), Number(filterMonth))) return false;
      if (filterType && leave.category !== filterType) return false;
      return true;
    });
  });

  const historyRowHeight = 96;
  const historyViewportHeight = 360;
  const historyWindow = $derived.by(() => {
    const start = Math.max(0, Math.floor(historyScrollTop / historyRowHeight) - 3);
    const visible = filteredHistory.slice(
      start,
      start + Math.ceil(historyViewportHeight / historyRowHeight) + 7
    );
    return { start, visible, bottom: Math.max(0, filteredHistory.length - start - visible.length) };
  });

  const monthlyRows = $derived.by(() =>
    Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const year = calendarYear;
      const key = `${year}-${String(month).padStart(2, '0')}`;
      const quantities = new Map<string, number>();
      let applied = 0;
      let approved = 0;
      let pending = 0;
      for (const leave of leavesForCalendar) {
        if (leave.status === 'rejected' || leave.status === 'cancelled') continue;
        const from = leave.startDate > `${key}-01` ? leave.startDate : `${key}-01`;
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const to = leave.endDate < `${key}-${String(lastDay).padStart(2, '0')}` ? leave.endDate : `${key}-${String(lastDay).padStart(2, '0')}`;
        if (from > to) continue;
        const portion = leave.calendarDays > 0 ? leave.leaveDays / leave.calendarDays : 1;
        const days = Math.max(0, eachDate(from, to).length * portion);
        applied += days;
        if (leave.status === 'approved') approved += days;
        else if (leave.status === 'pending' || leave.status === 'planned') pending += days;
        quantities.set(leave.category, (quantities.get(leave.category) ?? 0) + days);
      }
      const nmc = app.snapshot.attendance.filter(
        (record) => record.date.startsWith(key) && record.state === 'confirmed'
      ).length;
      const events = app.snapshot.events.filter((event) => {
        const end = event.endDate ?? event.date;
        return (
          end >= `${key}-01` &&
          event.date <= `${key}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}` &&
          ['academic', 'exam', 'invigilation', 'conference', 'meeting'].includes(event.type)
        );
      }).length;
      const duties = app.snapshot.duties.filter(
        (duty) => duty.status !== 'cancelled' && duty.date.startsWith(key)
      ).length;
      return {
        key,
        label: MONTH_NAMES[index],
        quantities: [...quantities.entries()]
          .map(([code, days]) => `${shortLabel(code)} ${round(days)}`)
          .join(' · '),
        nmc,
        applied: round(applied),
        approved: round(approved),
        pending: round(pending),
        events,
        duties
      };
    })
  );

  const actionLeave = $derived(
    actionLeaveId ? leavesForCalendar.find((leave) => leave.id === actionLeaveId) ?? null : null
  );
  const actionPdo = $derived(
    actionPdoId ? app.snapshot.pdos.find((pdo) => pdo.id === actionPdoId) ?? null : null
  );

  const actionCanConvert = $derived.by(() => {
    if (!actionDate || !context) return false;
    try {
      const evaluation = evaluateLeaveRequest(
        { category: 'CCL', startDate: actionDate, endDate: actionDate },
        {
          ...context,
          balances: app.balances,
          excludeLeaveId: actionLeave?.category === 'LOP' ? actionLeave.id : null,
          skipAttendanceImpact: true
        }
      );
      return !evaluation.reasons.some((reason) => reason.severity === 'error');
    } catch {
      return false;
    }
  });

  const confirmChecks = $derived.by(() =>
    confirmChunks.map((chunk) => {
      let evaluation: LeaveEvaluation | null = null;
      if (context && activeCategory) {
        try {
          evaluation = evaluateLeaveRequest(
            {
              category: activeCategory,
              startDate: chunk.startDate,
              endDate: chunk.endDate
            },
            { ...context, balances: app.balances, excludeLeaveId: editingLeaveId || null }
          );
        } catch {
          evaluation = null;
        }
      }
      return { chunk, evaluation };
    })
  );

  const confirmIsValid = $derived(
    !confirmed &&
      confirmChunks.length > 0 &&
      !selectionIssues.some((issue) => issue.severity === 'error') &&
      confirmChunks.every((chunk) => chunk.purpose.trim() && chunk.coveringDoctor.trim()) &&
      confirmChecks.every(
        (check) =>
          check.evaluation &&
          check.evaluation.status !== 'not-possible' &&
          check.evaluation.status !== 'indeterminate'
      )
  );

  function toggleType(code: string): void {
    if (code !== 'LOP' && (availability[code] ?? 0) < 1) return;
    activeCategory = activeCategory === code ? null : code;
    selectedDates = [];
    editingLeaveId = '';
    confirmed = false;
    copyText = '';
  }

  function changeYear(value: number): void {
    calendarYear = value;
    selectedDates = [];
    editingLeaveId = '';
    focusDate = '';
  }

  function applyDate(date: string, add: boolean): void {
    if (!activeCategory || (!eligibilityMap[date] && !selectedSet.has(date))) return;
    const next = new Set(selectedDates);
    if (add) next.add(date);
    else next.delete(date);
    selectedDates = [...next].sort();
  }

  function startSelection(event: PointerEvent, date: string): void {
    if (event.button !== 0 || !activeCategory) return;
    if (!eligibilityMap[date] && !selectedSet.has(date)) return;
    event.preventDefault();
    dragAdd = !selectedSet.has(date);
    applyDate(date, dragAdd);
  }

  function extendSelection(date: string): void {
    if (dragAdd === null) return;
    applyDate(date, dragAdd);
  }

  function moveSelection(event: PointerEvent): void {
    if (dragAdd === null) return;
    const element = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-planner-date]');
    const date = element?.dataset.plannerDate;
    if (date) extendSelection(date);
  }

  function chooseSuggestion(event: MouseEvent, date: string, category: string): void {
    event.stopPropagation();
    if (activeCategory === category) {
      selectedDates = [...new Set([...selectedDates, date])].sort();
    } else {
      activeCategory = category;
      selectedDates = [date];
    }
  }

  function openDayActions(date: string, chip?: PlannerChip): void {
    if (activeCategory) return;
    const chips = chipsByDate[date] ?? [];
    actionDate = date;
    actionLeaveId = chip?.leaveId ?? chips.find((item) => item.leaveId)?.leaveId ?? '';
    actionPdoId = chip?.pdoId ?? chips.find((item) => item.kind === 'pdo' && item.pdoId)?.pdoId ?? '';
    actionRetroCategory = 'CL';
    actionTargetDate = date < today ? today : date;
    actionOpen = true;
  }

  function openLedger(): void {
    filterYear = String(calendarYear);
    filterMonth = '';
    filterType = '';
    historyScrollTop = 0;
    ledgerOpen = true;
  }

  function closeLedger(): void {
    ledgerOpen = false;
  }

  function resetHistoryScroll(): void {
    historyScrollTop = 0;
  }

  function jumpToDate(date: string): void {
    ledgerOpen = false;
    focusDate = date;
    const year = Number(date.slice(0, 4));
    if (!(year === calendarYear || (year === calendarYear + 1 && Number(date.slice(5, 7)) <= 3))) {
      calendarYear = year;
    }
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>(`[data-planner-date="${date}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 80);
  }

  async function convertLop(): Promise<void> {
    if (!actionLeave || actionLeave.category !== 'LOP' || actionLeave.source !== 'ledger') return;
    if (!actionCanConvert) {
      app.notify('error', 'CCL is not available for this date under the current rules.');
      return;
    }
    const saved = await app.perform(
      async (services) => {
        await services.cancelLeave(actionLeave.id, 'LOP converted to CCL');
        return services.createLeave({
          category: 'CCL',
          startDate: actionLeave.startDate,
          endDate: actionLeave.endDate,
          status: 'pending',
          reason: 'LOP converted to CCL',
          notes: 'Converted from loss of pay in the leave planner.',
          purpose: 'LOP converted to CCL',
          coveringDoctor: '',
          source: 'planner'
        });
      },
      'LOP converted to a CCL application.'
    );
    if (saved) actionOpen = false;
  }

  async function convertPdo(): Promise<void> {
    if (!actionPdo || actionPdo.status !== 'scheduled') {
      app.notify('error', 'This PDO has no scheduled record yet.');
      return;
    }
    if (actionTargetDate < today) {
      app.notify('error', 'Choose today or a future date for the CCL.');
      return;
    }
    if (!actionCanConvert) {
      app.notify('error', 'CCL cannot be applied on the selected date.');
      return;
    }
    const saved = await app.perform(
      async (services) => {
        await services.resolvePdo(actionPdo.id, 'unused');
        return services.createLeave({
          category: 'CCL',
          startDate: actionTargetDate,
          endDate: actionTargetDate,
          status: 'pending',
          reason: 'PDO converted to CCL',
          notes: `PDO from ${actionPdo.date} converted to CCL.`,
          purpose: 'PDO converted to CCL',
          coveringDoctor: '',
          source: 'planner'
        });
      },
      'PDO converted to CCL and added as a leave application.'
    );
    if (saved) actionOpen = false;
  }

  function alterLeave(): void {
    if (!actionLeave || actionLeave.source !== 'ledger') return;
    if (actionLeave.status !== 'pending' && actionLeave.status !== 'planned') return;
    activeCategory = actionLeave.category;
    selectedDates = eachDate(actionLeave.startDate, actionLeave.endDate);
    editingLeaveId = actionLeave.id;
    confirmed = false;
    copyText = '';
    barOpen = true;
    actionOpen = false;
  }

  async function recordRetrospective(): Promise<void> {
    if (!actionDate || actionDate >= today) return;
    const saved = await app.perform(
      (services) =>
        services.createLeave({
          category: actionRetroCategory,
          startDate: actionDate,
          endDate: actionDate,
          status: 'pending',
          reason: `Retrospective ${actionRetroCategory}`,
          notes: 'Recorded retrospectively in the leave planner.',
          purpose: `Retrospective ${actionRetroCategory}`,
          coveringDoctor: '',
          source: 'retrospective'
        }),
      `Retrospective ${actionRetroCategory} added as a leave application.`
    );
    if (saved) actionOpen = false;
  }

  function openConfirm(): void {
    if (!activeCategory || selectedDates.length === 0) return;
    confirmChunks = contiguousRuns(selectedDates).map((run, index) => ({
      startDate: run[0],
      endDate: run[run.length - 1],
      purpose: index === 0 ? editingLeave?.purpose ?? '' : '',
      coveringDoctor: index === 0 ? editingLeave?.coveringDoctor ?? '' : ''
    }));
    confirmed = false;
    copyText = '';
    confirmOpen = true;
  }

  function suggestionsFor(chunk: ConfirmChunk): string[] {
    return doctorMatches(chunk.coveringDoctor, doctorNames);
  }

  function useCoveringDoctor(chunk: ConfirmChunk, name: string): void {
    chunk.coveringDoctor = name;
  }

  function buildCopyText(chunks: ConfirmChunk[]): string {
    const lines = [`Leave application · ${formatDate(today)}`];
    for (const chunk of chunks) {
      lines.push('');
      lines.push(`${rangeText(chunk.startDate, chunk.endDate)} · ${activeCategory ?? ''}`);
      lines.push(`Purpose: ${chunk.purpose}`);
      lines.push(`Covering doctor: ${chunk.coveringDoctor}`);
    }
    return lines.join('\n');
  }

  async function confirmLeaves(): Promise<void> {
    if (!activeCategory || !confirmIsValid) return;
    const category = activeCategory;
    const chunks = confirmChunks.map((chunk) => ({ ...chunk }));
    const replacingId = editingLeaveId;
    confirming = true;
    const saved = await app.perform(
      async (services) => {
        if (replacingId) {
          await services.cancelLeave(replacingId, 'Leave application altered in the planner.');
        }
        for (const chunk of chunks) {
          await services.createLeave({
            category,
            startDate: chunk.startDate,
            endDate: chunk.endDate,
            status: 'pending',
            reason: chunk.purpose,
            notes: `Covering doctor: ${chunk.coveringDoctor}`,
            purpose: chunk.purpose,
            coveringDoctor: chunk.coveringDoctor,
            source: 'planner'
          });
        }
        return true;
      },
      `${chunks.length} leave application${chunks.length === 1 ? '' : 's'} added to the ledger.`
    );
    confirming = false;
    if (saved) {
      copyText = buildCopyText(chunks);
      confirmed = true;
      selectedDates = [];
      activeCategory = null;
      editingLeaveId = '';
    }
  }

  async function copyLeaves(): Promise<void> {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      app.notify('success', 'Leave details copied to the clipboard.');
    } catch (error) {
      app.notify('error', messageOf(error));
    }
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (actionOpen) actionOpen = false;
    else if (confirmOpen) confirmOpen = false;
    else if (ledgerOpen) ledgerOpen = false;
  }

  function historyDecisionLabel(leave: HistoryItem): string {
    if (leave.status === 'approved') return `Approved ${formatDateTime(leave.decisionAt)}`;
    if (leave.status === 'rejected') return `Rejected ${formatDateTime(leave.decisionAt)}`;
    return leaveStatusLabel(leave.status);
  }
</script>

<svelte:window onpointerup={() => (dragAdd = null)} onpointercancel={() => (dragAdd = null)} onkeydown={handleWindowKeydown} />

<p class="planner-intro">{INTRO}</p>

<section class="planner-floating-bar" class:collapsed={!barOpen} aria-label="Leave planning controls">
  <div class="planner-bar-top">
    <div class="planner-bar-title">
      <CalendarDays size={16} />
      <div>
        <strong>Plan leave</strong>
        <span class="tiny muted">
          {activeCategory ? `${shortLabel(activeCategory)} selected` : 'Choose a leave type'}
        </span>
      </div>
    </div>
    <div class="planner-bar-actions">
      <label class="planner-year-field">
        <span>Year</span>
        <select
          class="input-base"
          value={calendarYear}
          onchange={(event) => changeYear(Number(event.currentTarget.value))}
        >
          {#each Array.from({ length: 7 }, (_, index) => Number(today.slice(0, 4)) - 3 + index) as year (year)}
            <option value={year}>{year}</option>
          {/each}
        </select>
      </label>
      <Button size="sm" variant="secondary" onclick={openLedger}>View ledger</Button>
      <Button size="sm" variant="success" disabled={!canOpenConfirm} onclick={openConfirm}>
        Confirm leaves
      </Button>
      <button
        type="button"
        class="icon-btn planner-collapse"
        aria-label={barOpen ? 'Collapse leave controls' : 'Expand leave controls'}
        aria-expanded={barOpen}
        onclick={() => (barOpen = !barOpen)}
      >
        <span class="planner-chevron" class:rotated={!barOpen}>
          <ChevronDown size={16} />
        </span>
      </button>
    </div>
  </div>

  {#if barOpen}
    <div class="planner-toggle-area">
      <div class="planner-toggle-group" role="group" aria-label="Leave types">
        {#each baseTypes as type (type.code)}
          {@const rule = categoryMap.get(type.code)}
          {#if rule}
            <button
              type="button"
              class="planner-type-toggle cat-{toneForCategory(type.code)}"
              class:active={activeCategory === type.code}
              disabled={(availability[type.code] ?? 0) < 1}
              aria-pressed={activeCategory === type.code}
              onclick={() => toggleType(type.code)}
            >
              {typeCountText(type.code)}
            </button>
          {/if}
        {/each}

        {#if moreTypes.length > 0}
          <button
            type="button"
            class="icon-btn planner-more-toggle"
            class:open={moreOpen}
            aria-label={moreOpen ? 'Hide more leave types' : 'Show more leave types'}
            aria-expanded={moreOpen}
            onclick={() => (moreOpen = !moreOpen)}
          >
            <ChevronRight size={15} />
          </button>
        {/if}

        {#if moreOpen}
          <div class="planner-more-types">
            {#each moreTypes as category (category.code)}
              <button
                type="button"
                class="planner-type-toggle cat-{toneForCategory(category.code)}"
                class:active={activeCategory === category.code}
                disabled={(availability[category.code] ?? 0) < 1}
                aria-pressed={activeCategory === category.code}
                title={category.fullForm}
                onclick={() => toggleType(category.code)}
              >
                {typeCountText(category.code)}
              </button>
            {/each}
          </div>
        {/if}

        {#if lopType}
          <button
            type="button"
            class="planner-type-toggle cat-lop planner-lop-toggle"
            class:active={activeCategory === 'LOP'}
            aria-pressed={activeCategory === 'LOP'}
            onclick={() => toggleType('LOP')}
          >
            LOP
          </button>
        {/if}
      </div>

      {#if selectedDates.length > 0}
        <div class="planner-selection-summary">
          <span>
            <strong>{selectedDates.length}</strong> day{selectedDates.length === 1 ? '' : 's'} selected
            {#if activeCategory}· {shortLabel(activeCategory)}{/if}
          </span>
          {#if selectionIssues.length > 0}
            <span class="planner-selection-warning" title={selectionIssues.map((issue) => issue.message).join('\n')}>
              {selectionIssues[0].message}
            </span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</section>  <div
    bind:this={calendarScroll}
    class="planner-calendar-scroll"
    class:has-category={Boolean(activeCategory)}
    role="region"
    aria-label={`Leave calendar ${calendarYear} to March ${calendarYear + 1}`}
    onpointermove={moveSelection}
  >
  <div class="planner-cal-dow">
    <span></span>
    {#each (app.settings?.weekStartsOn ?? 1) === 1 ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as label (label)}
      <span>{label}</span>
    {/each}
  </div>

  {#each monthLabels as month (month.key)}
    {@const rows = monthRows(month.year, month.month, (app.settings?.weekStartsOn ?? 1) as 0 | 1)}
    <div class="planner-cal-month" data-planner-month={month.key}>
      <div class="planner-cal-month-bar">
        <span>{month.label} {month.year}</span>
      </div>
      <div class="planner-cal-grid">
        {#each rows as row, rowIndex (rowIndex)}
          {#each row as date, cellIndex (date ?? `${month.key}-blank-${rowIndex}-${cellIndex}`)}
            {#if date}
              <div
                class="planner-day"
                class:today={date === today}
                class:eligible={Boolean(activeCategory && eligibilityMap[date])}
                class:selected={selectedSet.has(date)}
                class:focus={focusDate === date}
                data-planner-date={date}
                role="button"
                tabindex="0"
                aria-label={date}
                onpointerdown={(event) => startSelection(event, date)}
                onpointerenter={() => extendSelection(date)}
                onclick={() => {
                  if (!activeCategory) openDayActions(date);
                }}
                onkeydown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openDayActions(date);
                  }
                }}
              >
                <span class="planner-day-number">{Number(date.slice(8, 10))}</span>
                <div class="planner-day-chips">
                  {#if dayOfWeek(date) === 0}
                    <span class="planner-chip planner-chip-sunday" title="Sunday">S</span>
                  {/if}
                  {#each chipsByDate[date] ?? [] as chip (chip.kind + chip.label + (chip.leaveId ?? '') + (chip.pdoId ?? ''))}
                    <button
                      type="button"
                      class="planner-chip planner-chip-{chip.tone}"
                      class:pending={chip.kind === 'leave-pending'}
                      class:pdo-dotted={chip.kind === 'pdo'}
                      title={chip.title}
                      onpointerdown={(event) => event.stopPropagation()}
                      onclick={(event) => {
                        event.stopPropagation();
                        openDayActions(date, chip);
                      }}
                    >
                      {chip.label}
                    </button>
                  {/each}
                  {#if selectedSet.has(date) && activeCategory}
                    <span class="planner-chip cat-{toneForCategory(activeCategory)} planner-chip-selected">
                      {shortLabel(activeCategory)}
                    </span>
                  {/if}
                  {#if suggestedByDate[date] && !selectedSet.has(date)}
                    <button
                      type="button"
                      class="planner-chip cat-{toneForCategory(suggestedByDate[date])} planner-chip-suggested"
                      title={`Suggested ${shortLabel(suggestedByDate[date])} day`}
                      onpointerdown={(event) => event.stopPropagation()}
                      onclick={(event) => chooseSuggestion(event, date, suggestedByDate[date])}
                    >
                      {shortLabel(suggestedByDate[date])}
                    </button>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="planner-day blank"></div>
            {/if}
          {/each}
        {/each}
      </div>
    </div>
  {/each}
</div>

{#if ledgerOpen}
  <div
    class="planner-ledger-overlay"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) closeLedger();
    }}
  >
    <div class="planner-ledger-sheet" role="dialog" aria-modal="true" aria-label="Leave ledger">
      <header class="planner-ledger-head">
        <div>
          <h2>Leave ledger</h2>
          <p class="tiny muted">Balances, monthly activity and every leave application in one place.</p>
        </div>
        <button type="button" class="icon-btn" aria-label="Close leave ledger" onclick={closeLedger}>
          <X size={18} />
        </button>
      </header>

      <div class="planner-ledger-body">
        <section class="planner-ledger-summary" aria-label="Leave balance summary">
          {#each ledgerRows as row (row.code)}
            <div class="planner-ledger-stat">
              <span class={categoryChipClass(row.code)}>{row.label}</span>
              <strong>
                {row.remaining === Number.POSITIVE_INFINITY ? 'Unlimited' : `${round(row.remaining)} remaining`}
              </strong>
              <span class="tiny muted">
                {row.used} used · {row.applied} applied · {row.pending} pending
              </span>
            </div>
          {/each}
        </section>

        <section class="planner-ledger-section">
          <h3>{calendarYear} monthly summary</h3>
          <div class="planner-table-scroll">
            <table class="table-base planner-month-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Leaves taken</th>
                  <th>NMC punches</th>
                  <th>Applied</th>
                  <th>Approved</th>
                  <th>Pending</th>
                  <th>Academic events</th>
                  <th>Duty days</th>
                </tr>
              </thead>
              <tbody>
                {#each monthlyRows as row (row.key)}
                  <tr>
                    <td>{row.label}</td>
                    <td>{row.quantities || '—'}</td>
                    <td>{row.nmc}</td>
                    <td>{row.applied}</td>
                    <td>{row.approved}</td>
                    <td>{row.pending}</td>
                    <td>{row.events}</td>
                    <td>{row.duties}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>

        <section class="planner-ledger-section">
          <div class="planner-ledger-section-head">
            <h3>Leave history</h3>
            <span class="tiny muted">{filteredHistory.length} record{filteredHistory.length === 1 ? '' : 's'}</span>
          </div>

          <div class="planner-history-filters">
            <Toggle bind:checked={filterActive} label="Filter" onchange={resetHistoryScroll} />
            <Select
              label="Year"
              bind:value={filterYear}
              options={historyYears.map((year) => ({ value: year, label: year }))}
              disabled={!filterActive}
              onchange={resetHistoryScroll}
            />
            <Select
              label="Month"
              bind:value={filterMonth}
              options={[
                { value: '', label: 'All months' },
                ...MONTH_NAMES.map((month, index) => ({
                  value: String(index + 1).padStart(2, '0'),
                  label: month
                }))
              ]}
              disabled={!filterActive}
              onchange={resetHistoryScroll}
            />
            <Select
              label="Leave type"
              bind:value={filterType}
              options={[
                { value: '', label: 'All leave types' },
                ...historyTypes.map((code) => ({ value: code, label: shortLabel(code) }))
              ]}
              disabled={!filterActive}
              onchange={resetHistoryScroll}
            />
          </div>

          {#if filteredHistory.length === 0}
            <p class="tiny muted">No leave records match this filter.</p>
          {:else}
            <div
              class="planner-history-scroll"
              style={`max-height:${historyViewportHeight}px`}
              onscroll={(event) => (historyScrollTop = event.currentTarget.scrollTop)}
            >
              <div style={`height:${historyWindow.start * historyRowHeight}px`}></div>
              {#each historyWindow.visible as leave (leave.id)}
                <button
                  type="button"
                  class="planner-history-row"
                  style={`height:${historyRowHeight}px`}
                  onclick={() => jumpToDate(leave.startDate)}
                >
                  <span class="planner-history-date">
                    <strong>{formatDate(leave.startDate)}</strong>
                    {#if leave.endDate !== leave.startDate}
                      <span>to {formatDate(leave.endDate)}</span>
                    {/if}
                  </span>
                  <span class={categoryChipClass(leave.category)}>{shortLabel(leave.category)}</span>
                  <span class="planner-history-main">
                    <span class="planner-history-title">
                      {leaveStatusLabel(leave.status)}
                      {#if leave.status === 'pending' || leave.status === 'planned'}· awaiting approval{/if}
                    </span>
                    <span class="tiny muted">{leave.purpose || leave.category}</span>
                    {#if leave.coveringDoctor}<span class="tiny muted">Covering: {leave.coveringDoctor}</span>{/if}
                  </span>
                  <span class="planner-history-meta">
                    <span>Applied {formatDateTime(leave.appliedAt)}</span>
                    {#if leave.decisionAt}<span>{historyDecisionLabel(leave)}</span>{/if}
                  </span>
                </button>
              {/each}
              <div style={`height:${historyWindow.bottom * historyRowHeight}px`}></div>
            </div>
          {/if}
        </section>
      </div>
    </div>
  </div>
{/if}

<Dialog
  open={actionOpen}
  title="Day actions"
  subtitle={actionDate ? formatDate(actionDate) : ''}
  onclose={() => (actionOpen = false)}
>
  <div class="stack-sm">
    {#if actionLeave}
      <div class="planner-action-card">
        <span class={categoryChipClass(actionLeave.category)}>{shortLabel(actionLeave.category)}</span>
        <div>
          <strong>{rangeText(actionLeave.startDate, actionLeave.endDate)}</strong>
          <div class="tiny muted">{leaveStatusLabel(actionLeave.status)}</div>
          {#if actionLeave.purpose}<div class="tiny muted">Purpose: {actionLeave.purpose}</div>{/if}
          {#if actionLeave.coveringDoctor}<div class="tiny muted">Covering: {actionLeave.coveringDoctor}</div>{/if}
        </div>
      </div>
      {#if actionLeave.category === 'LOP' && actionLeave.source === 'ledger'}
        <Button variant="success" disabled={!actionCanConvert} onclick={convertLop}>
          Convert LOP to CCL
        </Button>
        {#if !actionCanConvert}<p class="tiny muted">A valid CCL credit is needed for this conversion.</p>{/if}
      {/if}
      {#if actionLeave.source === 'ledger' && (actionLeave.status === 'pending' || actionLeave.status === 'planned')}
        <Button variant="secondary" onclick={alterLeave}>Alter this leave</Button>
      {/if}
    {:else}
      <p class="tiny muted">No leave is recorded on this day.</p>
    {/if}

    {#if actionPdo}
      <div class="divider"></div>
      <div class="planner-action-card">
        <span class="chip cat-pdo">PDO</span>
        <div>
          <strong>Post-duty off</strong>
          <div class="tiny muted">Convert this PDO into a CCL application.</div>
        </div>
      </div>
      <label class="field">
        <span class="field-label">Apply CCL on</span>
        <input class="input-base" type="date" min={today} bind:value={actionTargetDate} />
      </label>
      <Button variant="success" disabled={!actionCanConvert} onclick={convertPdo}>
        Use PDO as CCL
      </Button>
    {:else if !actionLeave && actionDate < today}
      <div class="divider"></div>
      <Select
        label="Retrospective leave"
        bind:value={actionRetroCategory}
        options={[
          { value: 'CL', label: 'CL' },
          { value: 'CCL', label: 'CCL' }
        ]}
      />
      <Button variant="success" onclick={recordRetrospective}>
        Record retrospective leave
      </Button>
    {/if}
  </div>
</Dialog>

<Dialog
  open={confirmOpen}
  title="Confirm leaves"
  subtitle="Each continuous leave episode needs a purpose and a covering doctor."
  onclose={() => (confirmOpen = false)}
>
  {#if confirmed}
    <div class="banner banner-success">
      <Check size={16} />
      <div>
        <strong>Leaves added to the ledger.</strong>
        <div class="tiny">You can copy the application details and share them with HR.</div>
      </div>
    </div>
  {:else}
    {#if selectionIssues.some((issue) => issue.severity === 'error')}
      <div class="banner banner-warning" style="margin-bottom:8px">
        <div>
          {#each selectionIssues.filter((issue) => issue.severity === 'error').slice(0, 3) as issue (issue.message)}
            <div class="small">{issue.message}</div>
          {/each}
        </div>
      </div>
    {/if}
    <div class="confirm-chunks">
      {#each confirmChunks as chunk, index (chunk.startDate + chunk.endDate)}
        <div class="confirm-chunk">
          <div class="between">
            <div class="row">
              {#if activeCategory}
                <span class={categoryChipClass(activeCategory)}>{shortLabel(activeCategory)}</span>
              {/if}
              <strong>{rangeText(chunk.startDate, chunk.endDate)}</strong>
            </div>
            <span class="tiny muted">{eachDate(chunk.startDate, chunk.endDate).length} day(s)</span>
          </div>

          <label class="field">
            <span class="field-label">Purpose of leave</span>
            <input class="input-base" bind:value={chunk.purpose} placeholder="Why is the leave needed?" />
          </label>

          <div class="planner-doctor-field">
            <label class="field">
              <span class="field-label">Covering doctor</span>
              <input
                class="input-base"
                bind:value={chunk.coveringDoctor}
                placeholder="Start typing a doctor’s name"
                autocomplete="off"
              />
            </label>
            {#if suggestionsFor(chunk).length > 0}
              <div class="planner-doctor-suggestions">
                {#each suggestionsFor(chunk) as name (name)}
                  <button type="button" class="planner-doctor-suggestion" onclick={() => useCoveringDoctor(chunk, name)}>
                    {name}
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          {#if confirmChecks[index]?.evaluation}
            {@const check = confirmChecks[index].evaluation}
            {#if check}
              {#each check.reasons.filter((reason) => reason.severity === 'error' || reason.severity === 'condition' || reason.severity === 'warning').slice(0, 4) as reason (reason.code + reason.message)}
                <div class="planner-check-line planner-check-{reason.severity}">{reason.message}</div>
              {/each}
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmOpen = false)}>
      {confirmed ? 'Close' : 'Cancel'}
    </Button>
    {#if confirmed}
      <Button variant="success" disabled>Confirmed</Button>
      <Button variant="success" onclick={copyLeaves}>
        <ClipboardCopy size={14} /> Copy to clipboard
      </Button>
    {:else}
      <Button variant="success" disabled={!confirmIsValid || confirming} onclick={confirmLeaves}>
        {confirming ? 'Adding…' : 'Confirm'}
      </Button>
    {/if}
  {/snippet}
</Dialog>
