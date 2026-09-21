import type { CivilDate, ForecastItem, Money, Uuid, YearMonth } from '@home-mgmt/shared';
import { addMonths, maxMonth, monthOf, monthsBetween } from './civil-date';
import { ceilRupee, D, dec, minDec, sum, toMoney, ZERO, type Dec } from './money';

/**
 * The monthly reserve (ADR-011).
 *
 * Every future OUT occurrence accrues over its own window: from the later of
 * the previous occurrence of the same flow and today, up to the month before
 * it falls due. What is already earmarked (`reserved`) covers the nearest
 * occurrences first. Each occurrence's monthly contribution is rounded up to
 * the rupee.
 *
 * `thisMonth` is what to move now — it includes catching up on anything not
 * yet saved for. `steadyState` is where it settles once caught up: the next
 * twelve full months of outgoings, averaged.
 */
export interface SinkingFund {
  thisMonth: Money;
  steadyState: Money;
  byMonth: { month: YearMonth; amount: Money }[];
  perOccurrence: Accrual[];
  /** Earmarked money not needed by anything in the input. */
  unusedReserve: Money;
}

export interface Accrual {
  flowId: Uuid;
  dueDate: CivilDate;
  amount: Money;
  /** How much of `amount` the existing reserve already covers. */
  covered: Money;
  firstMonth: YearMonth;
  months: number;
  monthly: Money;
}

/**
 * @param items    OUT and IN forecast items, including past ones — the previous
 *                 occurrence of a flow is what opens the next one's window
 * @param today    in household time (ADR-013)
 * @param reserved `balanceSnapshot.reservedAmount`
 */
export function sinkingFund(items: ForecastItem[], today: CivilDate, reserved: Money): SinkingFund {
  const billed = items.filter((i) => i.direction === 'OUT' && i.status !== 'SKIPPED');
  const due = billed
    .filter((i) => i.dueDate >= today && i.status !== 'SETTLED')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.flowId.localeCompare(b.flowId));

  let remaining = dec(reserved);
  const perOccurrence = due.map((item) => {
    const covered = minDec(remaining, dec(item.amount));
    remaining = remaining.minus(covered);
    return accrue(item, previousDue(billed, item), today, covered);
  });

  const byMonth = totalByMonth(perOccurrence);
  return {
    thisMonth: byMonth.find((m) => m.month === monthOf(today))?.amount ?? toMoney(ZERO),
    steadyState: steadyState(billed, today),
    byMonth,
    perOccurrence,
    unusedReserve: toMoney(remaining),
  };
}

function accrue(item: ForecastItem, previous: CivilDate | null, today: CivilDate, covered: Dec): Accrual {
  const dueMonth = monthOf(item.dueDate);
  const firstMonth = previous ? maxMonth(monthOf(previous), monthOf(today)) : monthOf(today);
  // A bill falling due in its own opening month is funded in that month.
  const months = Math.max(1, monthsBetween(firstMonth, dueMonth));
  const need = dec(item.amount).minus(covered);
  return {
    flowId: item.flowId,
    dueDate: item.dueDate,
    amount: item.amount,
    covered: toMoney(covered),
    firstMonth,
    months,
    monthly: toMoney(need.gt(0) ? ceilRupee(need.div(months)) : ZERO),
  };
}

function previousDue(billed: ForecastItem[], item: ForecastItem): CivilDate | null {
  const earlier = billed
    .filter((b) => b.flowId === item.flowId && b.dueDate < item.dueDate)
    .map((b) => b.dueDate)
    .sort();
  return earlier.length ? earlier[earlier.length - 1] : null;
}

function totalByMonth(accruals: Accrual[]): { month: YearMonth; amount: Money }[] {
  const totals = new Map<YearMonth, Dec>();
  for (const a of accruals) {
    for (let i = 0; i < a.months; i++) {
      const m = addMonths(a.firstMonth, i);
      totals.set(m, (totals.get(m) ?? ZERO).plus(dec(a.monthly)));
    }
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount: toMoney(amount) }));
}

/**
 * The next twelve *full* months after the current one, averaged. Starting
 * mid-month would drop whatever already fell due this month and count a
 * monthly bill eleven times.
 */
function steadyState(billed: ForecastItem[], today: CivilDate): Money {
  const start = addMonths(monthOf(today), 1);
  const end = addMonths(start, 12);
  const year = billed.filter((b) => monthOf(b.dueDate) >= start && monthOf(b.dueDate) < end);
  return toMoney(ceilRupee(sum(year.map((b) => dec(b.amount))).div(D(12))));
}
