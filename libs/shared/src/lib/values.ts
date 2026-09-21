/**
 * Branded value types. These are plain strings at runtime — they survive JSON,
 * IndexedDB structured clone and signal equality unchanged — but the brand
 * stops an arbitrary string being passed where money or a day is expected.
 *
 * Money:     always two decimal places, e.g. "40000.00"             (ADR-012)
 * CivilDate: a calendar day, 'YYYY-MM-DD', no time and no zone      (ADR-013)
 * YearMonth: a calendar month, 'YYYY-MM'
 */

declare const moneyBrand: unique symbol;
declare const civilDateBrand: unique symbol;
declare const yearMonthBrand: unique symbol;

export type Money = string & { readonly [moneyBrand]: true };
export type CivilDate = string & { readonly [civilDateBrand]: true };
export type YearMonth = string & { readonly [yearMonthBrand]: true };
export type Uuid = string;

const MONEY = /^-?\d{1,12}\.\d{2}$/;
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMoney(value: string): value is Money {
  return MONEY.test(value);
}

/** Validates and brands. Throws on anything that is not `-?digits.dd`. */
export function money(value: string): Money {
  if (!isMoney(value)) {
    throw new TypeError(`Not a two-decimal money string: "${value}"`);
  }
  return value;
}

export function isCivilDate(value: string): value is CivilDate {
  const match = CIVIL_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

/** Validates and brands. Rejects impossible days such as 2026-02-30. */
export function civilDate(value: string): CivilDate {
  if (!isCivilDate(value)) {
    throw new TypeError(`Not a calendar day 'YYYY-MM-DD': "${value}"`);
  }
  return value;
}

export function isYearMonth(value: string): value is YearMonth {
  return YEAR_MONTH.test(value);
}

export function yearMonth(value: string): YearMonth {
  if (!isYearMonth(value)) {
    throw new TypeError(`Not a calendar month 'YYYY-MM': "${value}"`);
  }
  return value;
}

/** Gregorian month length. Lives here so validation needs no dependency. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
