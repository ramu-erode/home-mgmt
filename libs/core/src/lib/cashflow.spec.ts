import type { BalanceSnapshot } from '@home-mgmt/shared';
import { cashflow, SnapshotError } from './cashflow';
import { dec, sum, toMoney } from './money';
import { d, goal, item, m } from '../testing/builders';

const today = d('2026-09-21');
const snap = (balance: string, reserved = '0.00', asOf = '2026-09-21'): BalanceSnapshot => ({ asOf: d(asOf), balance: m(balance), reservedAmount: m(reserved) });
const salary = (month: string, status?: 'CONFIRMED') => item('client', `${month}-25`, '50000.00', { direction: 'IN', ...(status ? { status } : {}) });

describe('cashflow — balance lines', () => {
  it('separates confirmed income from all income; both subtract every outgoing', () => {
    const f = cashflow([salary('2026-09', 'CONFIRMED'), salary('2026-10'), item('fee', '2026-10-05', '20000.00')], snap('100000.00'), [], today, 2);
    expect(f.months.map((x) => [x.month, x.balanceAll, x.balanceConfirmed])).toEqual([
      ['2026-09', '150000.00', '150000.00'],
      ['2026-10', '180000.00', '130000.00'],
    ]);
  });

  it('skips SKIPPED occurrences and anything before the snapshot', () => {
    const f = cashflow([
      item('fee', '2026-09-10', '5000.00'),
      item('swim', '2026-10-01', '3000.00', { status: 'SKIPPED' }),
    ], snap('10000.00', '0.00', '2026-09-15'), [], today, 2);
    expect(f.months.map((x) => x.outgoings)).toEqual(['0.00', '0.00']);
  });

  it('rolls movements between the snapshot and today into the first month', () => {
    const f = cashflow([item('fee', '2026-08-28', '5000.00')], snap('10000.00', '0.00', '2026-08-20'), [], today, 1);
    expect(f.months[0].outgoings).toBe('5000.00');
  });
});

describe('cashflow — buckets', () => {
  const items = [
    item('ins', '2025-12-01', '36000.00', { status: 'SETTLED' }),
    item('ins', '2026-12-01', '36000.00'),
    ...['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'].map((mo) => salary(mo)),
  ];

  it('reserved + goalsSaved + free equals balanceAll in every month', () => {
    const f = cashflow(items, snap('20000.00', '6000.00'), [goal({ id: 'car', savedAmount: m('4000.00') })], today, 6);
    for (const x of f.months) {
      expect(toMoney(sum([dec(x.reserved), dec(x.goalsSaved), dec(x.free)]))).toBe(x.balanceAll);
    }
  });

  it('accrues the reserve before the bill and pays the bill from it', () => {
    const f = cashflow(items, snap('20000.00'), [], today, 4);
    // 36000 over Sep, Oct, Nov → 12000 a month; paid in December.
    expect(f.months.map((x) => [x.month, x.reserveContribution, x.reserved])).toEqual([
      ['2026-09', '12000.00', '12000.00'],
      ['2026-10', '12000.00', '24000.00'],
      ['2026-11', '12000.00', '36000.00'],
      ['2026-12', '0.00', '0.00'],
    ]);
  });

  it('shows the spike as negative free money when income cannot cover the catch-up', () => {
    const f = cashflow([item('ins', '2026-10-15', '60000.00')], snap('10000.00'), [], today, 2);
    // 60000 over Sep → funded entirely in September from a 10000 balance.
    expect(f.months[0].free).toBe('-50000.00');
  });
});

describe('cashflow — goals', () => {
  const income = ['2026-09', '2026-10', '2026-11'].map((mo) => item('client', `${mo}-25`, '10000.00', { direction: 'IN' }));

  it('funds goals after the reserve, in priority order', () => {
    const f = cashflow([...income, item('fee', '2026-10-05', '8000.00')], snap('0.00'), [
      goal({ id: 'trip', priority: 2, targetAmount: m('6000.00'), targetDate: d('2026-12-01') }),
      goal({ id: 'car', priority: 1, targetAmount: m('9000.00'), targetDate: d('2026-12-01') }),
    ], today, 1);
    const sep = f.months[0];
    // Reserve takes 8000 of 10000 first; 2000 remains; car (priority 1) wants 3000.
    expect(sep.reserveContribution).toBe('8000.00');
    expect(sep.goals.map((g) => [g.goalId, g.required, g.funded, g.underfunded])).toEqual([
      ['car', '3000.00', '2000.00', true],
      ['trip', '2000.00', '0.00', true],
    ]);
  });

  it('re-spreads what is missing and reports when the goal completes', () => {
    const f = cashflow(income, snap('0.00'), [goal({ id: 'car', targetAmount: m('9000.00'), targetDate: d('2026-12-01') })], today, 3);
    expect(f.months.map((x) => x.goals[0].saved)).toEqual(['3000.00', '6000.00', '9000.00']);
    expect(f.goals).toEqual([{ goalId: 'car', projectedCompletion: '2026-11' }]);
  });

  it('reports no completion when the goal cannot be met in the horizon', () => {
    const f = cashflow([], snap('0.00'), [goal({ id: 'car' })], today, 3);
    expect(f.goals[0].projectedCompletion).toBeNull();
  });

  it('never takes money from the reserve to fund a goal', () => {
    const f = cashflow([item('ins', '2026-10-15', '10000.00')], snap('10000.00', '10000.00'), [goal({ id: 'car' })], today, 1);
    expect(f.months[0].reserved).toBe('10000.00');
    expect(f.months[0].goals[0].funded).toBe('0.00');
  });
});

describe('cashflow — snapshot check', () => {
  it('refuses earmarks larger than the balance', () => {
    expect(() => cashflow([], snap('10000.00', '8000.00'), [goal({ id: 'car', savedAmount: m('3000.00') })], today)).toThrow(SnapshotError);
  });

  it('refuses a negative reserve', () => {
    expect(() => cashflow([], snap('10000.00', '-1.00'), [], today)).toThrow(SnapshotError);
  });

  it('defaults to an 18-month horizon starting this month', () => {
    const f = cashflow([], snap('0.00'), [], today);
    expect(f.months).toHaveLength(18);
    expect(f.months[0].month).toBe('2026-09');
    expect(f.months[17].month).toBe('2028-02');
  });
});
