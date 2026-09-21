import type { CivilDate, Flow, ForecastItem, Goal, Money, Occurrence } from '@home-mgmt/shared';

/** Test-only builders. Excluded from the library build (tsconfig.lib.json). */

export const d = (s: string) => s as CivilDate;
export const m = (s: string) => s as Money;

export function flow(overrides: Partial<Flow> & Pick<Flow, 'id'>): Flow {
  return {
    name: overrides.id,
    categoryId: null,
    direction: 'OUT',
    recurrenceKind: 'INTERVAL',
    freq: 'MONTHLY',
    interval: 1,
    months: null,
    dayOfMonth: 1,
    startDate: d('2026-01-01'),
    endDate: null,
    amounts: [{ effectiveFrom: d('2000-01-01'), amount: m('1000.00') }],
    allocations: [],
    ...overrides,
  };
}

export function occurrence(overrides: Partial<Occurrence> & Pick<Occurrence, 'id' | 'flowId' | 'ruleDate'>): Occurrence {
  return {
    direction: 'OUT',
    dueDate: overrides.ruleDate,
    amount: m('1000.00'),
    status: 'PLANNED',
    isAmountOverridden: false,
    isDateOverridden: false,
    ...overrides,
  };
}

export function item(flowId: string, dueDate: string, amount: string, extra: Partial<ForecastItem> = {}): ForecastItem {
  return { flowId, direction: 'OUT', dueDate: d(dueDate), amount: m(amount), ...extra };
}

export function goal(overrides: Partial<Goal> & Pick<Goal, 'id'>): Goal {
  return {
    name: overrides.id,
    memberId: null,
    targetAmount: m('12000.00'),
    targetDate: d('2027-09-01'),
    savedAmount: m('0.00'),
    priority: 1,
    ...overrides,
  };
}
