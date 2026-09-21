import { money, type CivilDate, type Money } from '@home-mgmt/shared';

/**
 * Display and input helpers. Money stays a decimal string throughout
 * (ADR-012); `Intl.NumberFormat` formats a string exactly, so no big.js here.
 */
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function formatMoney(value: Money): string {
  return inr.format(value as unknown as number); // ES2023: accepts decimal strings exactly
}

/**
 * Parses what a person types — "2500", "2,500", "₹2,500.5" — into Money, or
 * null. Never goes through a float.
 */
export function parseMoney(input: string): Money | null {
  const cleaned = input.replace(/[₹,\s]/g, '');
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  return money(`${match[1].replace(/^0+(?=\d)/, '')}.${(match[2] ?? '').padEnd(2, '0')}`);
}

/** A civil date as "5 Oct 2026". Formatted in UTC from UTC noon, so no timezone can shift the day (ADR-013). */
export function formatDate(date: CivilDate): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', style: 'currency', currency: 'INR', maximumFractionDigits: 1 });

/** "₹1.2L", "₹20K" — axis ticks only; every exact value is also in a table. */
export function formatCompact(value: Money | number): string {
  return compact.format(value as unknown as number);
}

/** A calendar month as "Nov 2026" (from 'YYYY-MM'). */
export function formatMonth(month: string, style: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat('en-IN', { month: style, year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
}

export const isNegative = (m: Money) => m.startsWith('-');

/** "5 Oct" — for lists where the month or year is already on screen. */
export function formatDay(date: CivilDate): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (m: number) => MONTHS[m - 1];

export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** Today in the household's zone (ADR-013). The phone's zone is the household's. */
export function today(): CivilDate {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) as CivilDate;
}
