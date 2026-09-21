import type { CivilDate } from '@home-mgmt/shared';
import { formatDate, formatMoney, ordinal, parseMoney } from './format';
import { preview, recurrenceSummary } from './flows/flow-model';

describe('money input and display', () => {
  it.each([
    ['2500', '2500.00'],
    ['2,500', '2500.00'],
    ['₹ 1,80,000.5', '180000.50'],
    ['0.05', '0.05'],
    ['007', '7.00'],
  ])('parses %s as %s', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(['', 'abc', '1.234', '-5', '1e3'])('refuses %s', (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it('formats in Indian grouping, without a float in between', () => {
    expect(formatMoney('180000.50' as never)).toBe('₹1,80,000.5');
    expect(formatMoney('36000.00' as never)).toBe('₹36,000');
  });
});

describe('dates', () => {
  it('formats a civil date without shifting it by timezone', () => {
    expect(formatDate('2026-06-01' as CivilDate)).toBe('1 Jun 2026');
  });

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 31].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '31st']);
  });
});

describe('flow summaries and previews', () => {
  const base = { recurrenceKind: 'INTERVAL' as const, freq: 'MONTHLY' as const, interval: 1, months: null, dayOfMonth: 5, startDate: '2026-01-05' as CivilDate };

  it('describes each cadence in words', () => {
    expect(recurrenceSummary(base)).toBe('Monthly on the 5th');
    expect(recurrenceSummary({ ...base, interval: 4, dayOfMonth: 20 })).toBe('Every 4 months on the 20th');
    expect(recurrenceSummary({ ...base, dayOfMonth: 31 })).toBe('Monthly on the last day');
    expect(recurrenceSummary({ ...base, freq: 'YEARLY', startDate: '2026-03-15' as CivilDate, dayOfMonth: 15 })).toBe('Yearly, Mar, on the 15th');
    expect(recurrenceSummary({ ...base, recurrenceKind: 'MONTHS', freq: null, months: [6, 10, 2] })).toBe('Jun, Oct, Feb on the 5th');
    expect(recurrenceSummary({ ...base, recurrenceKind: 'ONE_OFF', startDate: '2027-05-01' as CivilDate })).toBe('Once, on 1 May 2027');
  });

  it('previews what the engine will produce, or says why it cannot', () => {
    const flow = { ...base, id: 'f', name: 'x', categoryId: null, direction: 'OUT' as const, endDate: null, allocations: [], amounts: [{ effectiveFrom: '2027-01-01' as CivilDate, amount: '100.00' as never }] };
    expect(preview({ ...flow }, '2027-01-01' as CivilDate, 2).dates).toEqual([
      { date: '2027-01-05', amount: '100.00' },
      { date: '2027-02-05', amount: '100.00' },
    ]);
    expect(preview(flow, '2026-09-21' as CivilDate).error).toMatch(/no amount in force on 2026-10-05/);
  });
});
