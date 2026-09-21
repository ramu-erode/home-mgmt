import { sinkingFund } from './sinking-fund';
import { d, item, m } from '../testing/builders';

const today = d('2026-09-21');
const none = m('0.00');
const monthly = (r: ReturnType<typeof sinkingFund>) => Object.fromEntries(r.byMonth.map((x) => [x.month, x.amount]));

describe('sinkingFund — catch-up', () => {
  it('a bill two months out with nothing saved needs half of it each month, not a twelfth', () => {
    const r = sinkingFund([item('ins', '2026-11-15', '36000.00')], today, none);
    expect(r.thisMonth).toBe('18000.00');
    expect(monthly(r)).toEqual({ '2026-09': '18000.00', '2026-10': '18000.00' });
  });

  it('opens the window at today even when the previous occurrence was long ago', () => {
    const r = sinkingFund([item('ins', '2025-11-15', '36000.00', { status: 'SETTLED' }), item('ins', '2026-11-15', '36000.00')], today, none);
    expect(r.perOccurrence).toMatchObject([{ firstMonth: '2026-09', months: 2, monthly: '18000.00' }]);
  });

  it('funds a bill due later this month in this month', () => {
    const r = sinkingFund([item('fee', '2026-09-28', '5000.00')], today, none);
    expect(r.perOccurrence).toMatchObject([{ firstMonth: '2026-09', months: 1, monthly: '5000.00' }]);
  });

  it('rounds each contribution up to the rupee', () => {
    const r = sinkingFund([item('ins', '2026-08-01', '18500.00', { status: 'SETTLED' }), item('ins', '2027-08-01', '18500.00')], d('2026-08-01'), none);
    expect(r.perOccurrence[0]).toMatchObject({ months: 12, monthly: '1542.00' });
  });
});

describe('sinkingFund — convergence to steady state', () => {
  it('annual bill: catch-up now, steady from the next cycle', () => {
    const r = sinkingFund([
      item('ins', '2025-12-01', '12000.00', { status: 'SETTLED' }),
      item('ins', '2026-12-01', '12000.00'),
      item('ins', '2027-12-01', '12000.00'),
    ], today, none);
    expect(monthly(r)['2026-09']).toBe('4000.00');
    expect(monthly(r)['2026-11']).toBe('4000.00');
    expect(monthly(r)['2026-12']).toBe('1000.00');
    expect(monthly(r)['2027-11']).toBe('1000.00');
    expect(r.steadyState).toBe('1000.00');
  });

  it('steady state averages the next twelve full months', () => {
    const bills = Array.from({ length: 16 }, (_, i) => {
      const month = ((8 + i) % 12) + 1;
      const year = 2026 + Math.floor((8 + i) / 12);
      return item('swim', `${year}-${String(month).padStart(2, '0')}-01`, '1000.00', i === 0 ? { status: 'SETTLED' } : {});
    });
    expect(sinkingFund(bills, today, none).steadyState).toBe('1000.00');
  });
});

describe('sinkingFund — uneven terms {6,11,1}', () => {
  it('each term accrues over its own gap', () => {
    const r = sinkingFund([
      item('school', '2026-06-05', '30000.00', { status: 'SETTLED' }),
      item('school', '2026-11-05', '30000.00'),
      item('school', '2027-01-05', '30000.00'),
      item('school', '2027-06-05', '30000.00'),
    ], today, none);
    expect(r.perOccurrence.map((a) => [a.dueDate, a.months, a.monthly])).toEqual([
      ['2026-11-05', 2, '15000.00'],
      ['2027-01-05', 2, '15000.00'],
      ['2027-06-05', 5, '6000.00'],
    ]);
    expect(monthly(r)).toMatchObject({ '2026-10': '15000.00', '2026-12': '15000.00', '2027-03': '6000.00' });
  });
});

describe('sinkingFund — existing reserve', () => {
  it('covers the nearest occurrence first', () => {
    const r = sinkingFund([item('ins', '2026-11-15', '36000.00'), item('car', '2027-03-01', '12000.00')], today, m('20000.00'));
    expect(r.perOccurrence.map((a) => [a.flowId, a.covered, a.monthly])).toEqual([
      ['ins', '20000.00', '8000.00'],
      ['car', '0.00', '2000.00'],
    ]);
  });

  it('reports reserve nothing needs', () => {
    const r = sinkingFund([item('ins', '2026-11-15', '36000.00')], today, m('50000.00'));
    expect(r.perOccurrence[0].monthly).toBe('0.00');
    expect(r.unusedReserve).toBe('14000.00');
    expect(r.thisMonth).toBe('0.00');
  });
});

describe('sinkingFund — what counts', () => {
  it('ignores income, skipped and already-settled occurrences', () => {
    const r = sinkingFund([
      item('rent', '2026-10-01', '25000.00', { direction: 'IN' }),
      item('swim', '2026-10-01', '1000.00', { status: 'SKIPPED' }),
      item('fee', '2026-10-01', '3000.00', { status: 'SETTLED' }),
    ], today, none);
    expect(r.perOccurrence).toEqual([]);
    expect(r.thisMonth).toBe('0.00');
  });

  it('a skipped term does not open the next window', () => {
    const r = sinkingFund([
      item('swim', '2026-09-01', '3000.00', { status: 'SETTLED' }),
      item('swim', '2026-10-01', '3000.00', { status: 'SKIPPED' }),
      item('swim', '2026-12-01', '3000.00'),
    ], today, none);
    expect(r.perOccurrence).toMatchObject([{ dueDate: '2026-12-01', firstMonth: '2026-09', months: 3, monthly: '1000.00' }]);
  });

  it('counts a CONFIRMED occurrence — confirmed is still to be paid', () => {
    const r = sinkingFund([item('fee', '2026-10-10', '2000.00', { status: 'CONFIRMED' })], today, none);
    expect(r.thisMonth).toBe('2000.00');
  });
});
