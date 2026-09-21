import type { BalanceSnapshot, CivilDate, Flow, ForecastItem, Goal } from '@home-mgmt/shared';
import household from '../testing/synthetic-household.json';
import expected from '../testing/synthetic-household.expected.json';
import { cashflow } from './cashflow';
import { project } from './project';
import { sinkingFund } from './sinking-fund';

/**
 * The Phase 1 done-criterion: the engine reproduces a hand-calculated 18-month
 * forecast for the synthetic household. The expected figures were worked out
 * by listing due dates, not by running this code — see the `workings` in the
 * expected file.
 */
const today = household.today as CivilDate;
const flows = household.flows as unknown as Flow[];
const snapshot = household.snapshot as unknown as BalanceSnapshot;
const goals = household.goals as unknown as Goal[];

// History from a year back, so every flow's previous occurrence is known to
// the reserve; anything already past counts as settled.
const items: ForecastItem[] = project(flows, '2025-09-01' as CivilDate, '2028-02-29' as CivilDate).map((e) => ({
  flowId: e.flowId,
  direction: e.direction,
  dueDate: e.ruleDate,
  amount: e.amount,
  status: e.ruleDate < today ? 'SETTLED' : 'PLANNED',
}));

describe('golden — synthetic household, 18 months', () => {
  const forecast = cashflow(items, snapshot, goals, today);

  it('matches the hand-calculated outgoings, income and balance month by month', () => {
    const actual = forecast.months.map(({ month, outgoings, incomeAll, balanceAll }) => ({ month, outgoings, incomeAll, balanceAll }));
    expect(actual).toEqual(expected.months);
  });

  it('matches the hand-calculated steady-state reserve', () => {
    expect(sinkingFund(items, today, snapshot.reservedAmount).steadyState).toBe(expected.steadyState);
  });

  it('keeps the buckets summing to the balance throughout', () => {
    for (const m of forecast.months) {
      const buckets = Number(m.reserved) * 100 + Number(m.goalsSaved) * 100 + Number(m.free) * 100;
      expect(Math.round(buckets)).toBe(Math.round(Number(m.balanceAll) * 100));
    }
  });
});
