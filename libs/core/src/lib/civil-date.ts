import { daysInMonth, type CivilDate, type YearMonth } from '@home-mgmt/shared';

/**
 * Calendar arithmetic on civil dates (ADR-013). Integers only — JS Date is
 * banned in this library because it turns a day into an instant and shifts it
 * by timezone. ISO strings compare correctly with < and >, so no compare
 * helper is needed.
 */

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function parseDate(date: CivilDate): Ymd {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

export function formatDate(y: number, m: number, d: number): CivilDate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}` as CivilDate;
}

export function formatMonth(y: number, m: number): YearMonth {
  return `${pad(y, 4)}-${pad(m)}` as YearMonth;
}

export function monthOf(date: CivilDate): YearMonth {
  return date.slice(0, 7) as YearMonth;
}

/** Months since year 0 — makes month arithmetic plain integer arithmetic. */
export function monthIndex(month: YearMonth): number {
  const [y, m] = month.split('-').map(Number);
  return y * 12 + (m - 1);
}

export function monthFromIndex(index: number): YearMonth {
  return formatMonth(Math.floor(index / 12), (index % 12) + 1);
}

export function addMonths(month: YearMonth, n: number): YearMonth {
  return monthFromIndex(monthIndex(month) + n);
}

/** Whole months from `a` to `b`; negative when `b` is earlier. */
export function monthsBetween(a: YearMonth, b: YearMonth): number {
  return monthIndex(b) - monthIndex(a);
}

/** `day` in `month`, clamped to month-end — a bill on the 31st never skips. */
export function dayInMonth(month: YearMonth, day: number): CivilDate {
  const [y, m] = month.split('-').map(Number);
  return formatDate(y, m, Math.min(day, daysInMonth(y, m)));
}

export function maxMonth(a: YearMonth, b: YearMonth): YearMonth {
  return a > b ? a : b;
}
