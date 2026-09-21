import { InvalidFlowError, amountOn, project, ruleDates } from './project';
import { d, flow, m } from '../testing/builders';

const dates = (f: Parameters<typeof ruleDates>[0], from: string, to: string) => ruleDates(f, d(from), d(to));

describe('INTERVAL', () => {
  const fourMonthly = flow({ id: 'f4', interval: 4, dayOfMonth: 10, startDate: d('2026-11-10') });

  it('interval=4 steps across a year boundary', () => {
    expect(dates(fourMonthly, '2026-01-01', '2027-12-31')).toEqual(['2026-11-10', '2027-03-10', '2027-07-10', '2027-11-10']);
  });

  it('counts steps from startDate, not from the window', () => {
    expect(dates(fourMonthly, '2027-04-01', '2027-12-31')).toEqual(['2027-07-10', '2027-11-10']);
  });

  it('day 31 clamps to month-end in short months — never skips', () => {
    const f = flow({ id: 'eom', dayOfMonth: 31, startDate: d('2026-01-31') });
    expect(dates(f, '2026-01-01', '2026-05-31')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('YEARLY repeats on the same day each year', () => {
    const f = flow({ id: 'ins', freq: 'YEARLY', interval: 1, dayOfMonth: 15, startDate: d('2026-03-15') });
    expect(dates(f, '2026-01-01', '2028-12-31')).toEqual(['2026-03-15', '2027-03-15', '2028-03-15']);
  });

  it('a start mid-month after the billing day begins the following month', () => {
    const f = flow({ id: 'late', dayOfMonth: 1, startDate: d('2026-09-15') });
    expect(dates(f, '2026-09-01', '2026-11-30')).toEqual(['2026-10-01', '2026-11-01']);
  });

  it('stops at endDate', () => {
    const f = flow({ id: 'ends', dayOfMonth: 5, startDate: d('2026-01-05'), endDate: d('2026-03-31') });
    expect(dates(f, '2026-01-01', '2026-12-31')).toEqual(['2026-01-05', '2026-02-05', '2026-03-05']);
  });
});

describe('MONTHS', () => {
  it('term billing months = {6,10,2}', () => {
    const f = flow({ id: 'school', recurrenceKind: 'MONTHS', freq: null, interval: null, months: [6, 10, 2], dayOfMonth: 5, startDate: d('2026-06-01') });
    expect(dates(f, '2026-01-01', '2027-06-30')).toEqual(['2026-06-05', '2026-10-05', '2027-02-05', '2027-06-05']);
  });

  it('uneven terms {6,11,1} and clamping in February', () => {
    const f = flow({ id: 'uneven', recurrenceKind: 'MONTHS', freq: null, interval: null, months: [11, 1, 6, 2], dayOfMonth: 30, startDate: d('2026-01-01') });
    expect(dates(f, '2026-10-01', '2027-06-30')).toEqual(['2026-11-30', '2027-01-30', '2027-02-28', '2027-06-30']);
  });
});

describe('ONE_OFF', () => {
  const trip = flow({ id: 'trip', recurrenceKind: 'ONE_OFF', freq: null, interval: null, dayOfMonth: null, startDate: d('2027-04-20') });

  it('appears once, inside the window', () => {
    expect(dates(trip, '2026-09-01', '2028-03-01')).toEqual(['2027-04-20']);
  });

  it('does not appear outside it', () => {
    expect(dates(trip, '2027-05-01', '2028-03-01')).toEqual([]);
  });
});

describe('amount resolution', () => {
  const hiked = flow({
    id: 'fee',
    amounts: [
      { effectiveFrom: d('2027-06-01'), amount: m('4200.00') },
      { effectiveFrom: d('2026-01-01'), amount: m('4000.00') },
    ],
  });

  it('uses the latest amount effective on or before the date', () => {
    expect(amountOn(hiked, d('2027-05-01'))).toBe('4000.00');
    expect(amountOn(hiked, d('2027-06-01'))).toBe('4200.00');
    expect(amountOn(hiked, d('2027-07-01'))).toBe('4200.00');
  });

  it('treats a date before every amount as a data error, not zero', () => {
    expect(() => amountOn(hiked, d('2025-12-31'))).toThrow(InvalidFlowError);
  });
});

describe('project', () => {
  it('carries direction and amount, sorted by date then flow', () => {
    const rent = flow({ id: 'rent', direction: 'IN', dayOfMonth: 1, amounts: [{ effectiveFrom: d('2026-01-01'), amount: m('25000.00') }] });
    const swim = flow({ id: 'a-swim', dayOfMonth: 1 });
    const out = project([rent, swim], d('2026-09-01'), d('2026-10-31'));
    expect(out).toEqual([
      { flowId: 'a-swim', direction: 'OUT', ruleDate: '2026-09-01', amount: '1000.00' },
      { flowId: 'rent', direction: 'IN', ruleDate: '2026-09-01', amount: '25000.00' },
      { flowId: 'a-swim', direction: 'OUT', ruleDate: '2026-10-01', amount: '1000.00' },
      { flowId: 'rent', direction: 'IN', ruleDate: '2026-10-01', amount: '25000.00' },
    ]);
  });

  it.each([
    ['interval zero', { interval: 0 }],
    ['day 32', { dayOfMonth: 32 }],
    ['no freq', { freq: null }],
    ['empty months', { recurrenceKind: 'MONTHS' as const, months: [] }],
    ['month 13', { recurrenceKind: 'MONTHS' as const, months: [13] }],
    ['end before start', { endDate: d('2025-01-01') }],
    ['no amounts', { amounts: [] }],
  ])('rejects an invalid rule: %s', (_, bad) => {
    expect(() => project([flow({ id: 'bad', ...bad })], d('2026-01-01'), d('2026-12-31'))).toThrow(InvalidFlowError);
  });
});
