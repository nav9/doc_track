import {
  MONTH_NAMES,
  addDays,
  dayOfWeek,
  daysInMonth,
  eachDate,
  monthKey
} from '../../domain/common/dates';

export interface PlannerMonth {
  year: number;
  month: number;
  key: string;
  label: string;
}

/** January of the selected year through March of the following year. */
export function plannerMonths(year: number): PlannerMonth[] {
  return Array.from({ length: 15 }, (_, index) => {
    const monthIndex = index;
    const monthYear = year + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    return {
      year: monthYear,
      month,
      key: monthKey(`${monthYear}-${String(month).padStart(2, '0')}-01`),
      label: MONTH_NAMES[month - 1]
    };
  });
}

/** A month laid out in seven-column rows, with blanks before and after it. */
export function monthRows(year: number, month: number, weekStartsOn: 0 | 1): (string | null)[][] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const offset = (dayOfWeek(first) - weekStartsOn + 7) % 7;
  const cells: (string | null)[] = Array.from({ length: offset }, () => null);
  const total = daysInMonth(year, month);
  for (let day = 0; day < total; day += 1) cells.push(addDays(first, day));
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (string | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    rows.push(cells.slice(index, index + 7));
  }
  return rows;
}

/** Splits a set of selected dates into contiguous leave episodes. */
export function contiguousRuns(dates: string[]): string[][] {
  const ordered = [...new Set(dates)].sort();
  const runs: string[][] = [];
  let current: string[] = [];
  for (const date of ordered) {
    if (current.length === 0 || date === addDays(current[current.length - 1], 1)) {
      current.push(date);
    } else {
      runs.push(current);
      current = [date];
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

export function rangeDates(startDate: string, endDate: string): string[] {
  return eachDate(startDate, endDate);
}

export function levenshtein(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

/** Fuzzy doctor-name matches, best first. */
export function doctorMatches(query: string, names: string[], limit = 5): string[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const threshold = Math.max(2, Math.ceil(needle.length * 0.35));
  return [...new Set(names)]
    .map((name) => {
      const lower = name.trim().toLowerCase();
      const distance = levenshtein(needle, lower);
      const contains = lower.includes(needle) || needle.includes(lower);
      return { name, score: contains ? Math.max(0, distance - 2) : distance };
    })
    .filter((match) => match.score <= threshold)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((match) => match.name);
}
