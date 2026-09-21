import type { YearMonth } from '@home-mgmt/shared';
import { addMonths, dayInMonth, monthOf, monthsBetween, parseDate, formatDate } from './civil-date';
import { d } from '../testing/builders';

const ym = (s: string) => s as YearMonth;

describe('civil dates', () => {
  it('round-trips without any timezone involvement', () => {
    expect(parseDate(d('2026-06-01'))).toEqual({ y: 2026, m: 6, d: 1 });
    expect(formatDate(2026, 6, 1)).toBe('2026-06-01');
    expect(monthOf(d('2026-06-30'))).toBe('2026-06');
  });

  it('adds months across year boundaries in both directions', () => {
    expect(addMonths(ym('2026-11'), 4)).toBe('2027-03');
    expect(addMonths(ym('2027-02'), -3)).toBe('2026-11');
    expect(addMonths(ym('2026-01'), 24)).toBe('2028-01');
  });

  it('counts months between', () => {
    expect(monthsBetween(ym('2026-09'), ym('2026-11'))).toBe(2);
    expect(monthsBetween(ym('2026-11'), ym('2027-02'))).toBe(3);
    expect(monthsBetween(ym('2027-02'), ym('2026-11'))).toBe(-3);
  });

  it('clamps day 31 to month-end rather than skipping', () => {
    expect(dayInMonth(ym('2026-04'), 31)).toBe('2026-04-30');
    expect(dayInMonth(ym('2026-02'), 31)).toBe('2026-02-28');
    expect(dayInMonth(ym('2028-02'), 30)).toBe('2028-02-29');
    expect(dayInMonth(ym('2026-05'), 31)).toBe('2026-05-31');
  });
});
