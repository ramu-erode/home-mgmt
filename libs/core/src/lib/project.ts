import type { CivilDate, ExpectedOccurrence, Flow, Money, YearMonth } from '@home-mgmt/shared';
import { addMonths, dayInMonth, monthOf, monthsBetween } from './civil-date';

export class InvalidFlowError extends Error {
  constructor(flowId: string, reason: string) {
    super(`Flow ${flowId}: ${reason}`);
    this.name = 'InvalidFlowError';
  }
}

/**
 * Expands rules into the occurrences they produce with rule dates in
 * [from, to], sorted by date then flow. Pure: knows nothing about existing
 * rows — `reconcile` decides what to do with the result.
 */
export function project(flows: Flow[], from: CivilDate, to: CivilDate): ExpectedOccurrence[] {
  return flows
    .flatMap((flow) => ruleDates(flow, from, to).map((ruleDate) => expected(flow, ruleDate)))
    .sort((a, b) => a.ruleDate.localeCompare(b.ruleDate) || a.flowId.localeCompare(b.flowId));
}

function expected(flow: Flow, ruleDate: CivilDate): ExpectedOccurrence {
  return { flowId: flow.id, direction: flow.direction, ruleDate, amount: amountOn(flow, ruleDate) };
}

/** Every date the rule produces within [from, to] and within the flow's own life. */
export function ruleDates(flow: Flow, from: CivilDate, to: CivilDate): CivilDate[] {
  validate(flow);
  const lo = flow.startDate > from ? flow.startDate : from;
  const hi = flow.endDate && flow.endDate < to ? flow.endDate : to;
  if (lo > hi) return [];
  return candidates(flow, monthOf(lo), monthOf(hi)).filter((d) => d >= lo && d <= hi);
}

function candidates(flow: Flow, first: YearMonth, last: YearMonth): CivilDate[] {
  // validate() has guaranteed the kind-specific fields; the defaults only
  // satisfy the type checker.
  const day = flow.dayOfMonth ?? 1;
  switch (flow.recurrenceKind) {
    case 'ONE_OFF':
      return [flow.startDate];
    case 'MONTHS': {
      const months = flow.months ?? [];
      return monthsRange(first, last)
        .filter((m) => months.includes(parseMonth(m)))
        .map((m) => dayInMonth(m, day));
    }
    case 'INTERVAL':
      return intervalMonths(flow, first, last).map((m) => dayInMonth(m, day));
  }
}

/** Months counted in steps from the month of startDate, never from `from`. */
function intervalMonths(flow: Flow, first: YearMonth, last: YearMonth): YearMonth[] {
  const step = (flow.interval ?? 1) * (flow.freq === 'YEARLY' ? 12 : 1);
  const anchor = monthOf(flow.startDate);
  const k0 = Math.max(0, Math.ceil(monthsBetween(anchor, first) / step));
  const out: YearMonth[] = [];
  for (let k = k0; ; k++) {
    const m = addMonths(anchor, k * step);
    if (m > last) return out;
    out.push(m);
  }
}

function monthsRange(first: YearMonth, last: YearMonth): YearMonth[] {
  const n = monthsBetween(first, last);
  return Array.from({ length: n + 1 }, (_, i) => addMonths(first, i));
}

function parseMonth(m: YearMonth): number {
  return Number(m.slice(5, 7));
}

/**
 * The amount in force on `date`: the latest scheduled amount effective on or
 * before it. A date before every scheduled amount is a data error, not a zero.
 */
export function amountOn(flow: Flow, date: CivilDate): Money {
  const inForce = flow.amounts
    .filter((a) => a.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (!inForce) throw new InvalidFlowError(flow.id, `no amount in force on ${date}`);
  return inForce.amount;
}

function validate(flow: Flow): void {
  const fail = (reason: string) => {
    throw new InvalidFlowError(flow.id, reason);
  };
  if (flow.endDate && flow.endDate < flow.startDate) fail('endDate before startDate');
  if (flow.amounts.length === 0) fail('no amounts');
  if (flow.recurrenceKind === 'ONE_OFF') return;
  if (!isDay(flow.dayOfMonth)) fail('dayOfMonth must be 1–31');
  if (flow.recurrenceKind === 'MONTHS' && !validMonths(flow.months)) fail('months must be a non-empty set of 1–12');
  if (flow.recurrenceKind === 'INTERVAL' && !flow.freq) fail('INTERVAL needs freq');
  if (flow.recurrenceKind === 'INTERVAL' && !isPositiveInt(flow.interval)) fail('interval must be a positive integer');
}

const isPositiveInt = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 1;
const isDay = (d: number | null) => isPositiveInt(d) && d <= 31;
const validMonths = (ms: number[] | null) => !!ms && ms.length > 0 && ms.every((m) => Number.isInteger(m) && m >= 1 && m <= 12);
