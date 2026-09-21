import type { BalanceSnapshot, CivilDate, ForecastItem, Goal, Money, Uuid, YearMonth } from '@home-mgmt/shared';
import { addMonths, maxMonth, monthOf, monthsBetween } from './civil-date';
import { ceilRupee, dec, maxDec, minDec, sum, toMoney, ZERO, type Dec } from './money';
import { sinkingFund } from './sinking-fund';

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/**
 * One month of the forecast (ADR-011). Two views of the same money:
 *
 * - Balance lines: `balanceAll` counts all expected income, `balanceConfirmed`
 *   only CONFIRMED/SETTLED income. Both subtract every outgoing.
 * - Buckets: `reserved + goalsSaved + free === balanceAll`, always. Income lands
 *   in free; the reserve contribution moves free → reserved; bills are paid
 *   from reserved (any shortfall from free); goals are funded from what free has
 *   left, in priority order. Bills always come before goals.
 *
 * A negative `free` is the spike the app exists to show.
 */
export interface MonthPosition {
  month: YearMonth;
  incomeAll: Money;
  incomeConfirmed: Money;
  outgoings: Money;
  reserveContribution: Money;
  balanceAll: Money;
  balanceConfirmed: Money;
  reserved: Money;
  goalsSaved: Money;
  free: Money;
  goals: GoalMonth[];
}

export interface GoalMonth {
  goalId: Uuid;
  required: Money;
  funded: Money;
  saved: Money;
  /** `funded < required` — the goal is slipping this month. */
  underfunded: boolean;
}

export interface Forecast {
  months: MonthPosition[];
  goals: { goalId: Uuid; projectedCompletion: YearMonth | null }[];
}

interface Buckets {
  all: Dec;
  confirmed: Dec;
  reserved: Dec;
  free: Dec;
  saved: Map<Uuid, Dec>;
}

/**
 * @param items    every occurrence the horizon touches, OUT and IN, including
 *                 past ones (the reserve needs each flow's previous occurrence)
 * @param horizon  number of months, starting with the month of `today`
 */
export function cashflow(
  items: ForecastItem[],
  snapshot: BalanceSnapshot,
  goals: Goal[],
  today: CivilDate,
  horizon = 18,
): Forecast {
  assertSnapshot(snapshot, goals);
  const first = monthOf(today);
  const contributions = new Map(sinkingFund(items, today, snapshot.reservedAmount).byMonth.map((m) => [m.month, dec(m.amount)]));
  const movements = groupByMonth(items, snapshot.asOf, first);
  const ordered = [...goals].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const buckets = openingBuckets(snapshot, goals);

  const months: MonthPosition[] = [];
  for (let i = 0; i < horizon; i++) {
    const month = addMonths(first, i);
    months.push(step(month, movements.get(month) ?? [], contributions.get(month) ?? ZERO, ordered, buckets));
  }
  return { months, goals: ordered.map((g) => ({ goalId: g.id, projectedCompletion: completion(g, months) })) };
}

function step(month: YearMonth, moves: ForecastItem[], contribution: Dec, goals: Goal[], b: Buckets): MonthPosition {
  const incomeAll = total(moves, (m) => m.direction === 'IN');
  const incomeConfirmed = total(moves, (m) => m.direction === 'IN' && (m.status === 'CONFIRMED' || m.status === 'SETTLED'));
  const outgoings = total(moves, (m) => m.direction === 'OUT');

  b.all = b.all.plus(incomeAll).minus(outgoings);
  b.confirmed = b.confirmed.plus(incomeConfirmed).minus(outgoings);
  payBills(b, contribution, outgoings);
  b.free = b.free.plus(incomeAll).minus(contribution);
  const goalMonths = fundGoals(month, goals, b);

  return {
    month,
    incomeAll: toMoney(incomeAll),
    incomeConfirmed: toMoney(incomeConfirmed),
    outgoings: toMoney(outgoings),
    reserveContribution: toMoney(contribution),
    balanceAll: toMoney(b.all),
    balanceConfirmed: toMoney(b.confirmed),
    reserved: toMoney(b.reserved),
    goalsSaved: toMoney(sum([...b.saved.values()])),
    free: toMoney(b.free),
    goals: goalMonths,
  };
}

/** Bills come out of the reserve; whatever it cannot cover comes out of free. */
function payBills(b: Buckets, contribution: Dec, outgoings: Dec): void {
  b.reserved = b.reserved.plus(contribution).minus(outgoings);
  if (b.reserved.lt(0)) {
    b.free = b.free.plus(b.reserved);
    b.reserved = ZERO;
  }
}

function fundGoals(month: YearMonth, goals: Goal[], b: Buckets): GoalMonth[] {
  let available = maxDec(b.free, ZERO);
  return goals.map((g) => {
    const saved = b.saved.get(g.id) ?? ZERO;
    const required = requiredContribution(g, saved, month);
    const funded = minDec(required, available);
    available = available.minus(funded);
    b.free = b.free.minus(funded);
    b.saved.set(g.id, saved.plus(funded));
    return {
      goalId: g.id,
      required: toMoney(required),
      funded: toMoney(funded),
      saved: toMoney(saved.plus(funded)),
      underfunded: funded.lt(required),
    };
  });
}

/** What is still missing, spread over the months left before the target month, up to the rupee. */
function requiredContribution(g: Goal, saved: Dec, month: YearMonth): Dec {
  const missing = dec(g.targetAmount).minus(saved);
  if (missing.lte(0)) return ZERO;
  const monthsLeft = Math.max(1, monthsBetween(month, monthOf(g.targetDate)));
  return ceilRupee(missing.div(monthsLeft));
}

function completion(g: Goal, months: MonthPosition[]): YearMonth | null {
  const target = dec(g.targetAmount);
  const saved = (m: MonthPosition) => m.goals.find((x) => x.goalId === g.id)?.saved;
  const hit = months.find((m) => {
    const s = saved(m);
    return s !== undefined && dec(s).gte(target);
  });
  return hit?.month ?? null;
}

/**
 * Movements since the snapshot, by month. Anything between the snapshot and
 * the first forecast month is not yet in the balance, so it lands in the
 * first month rather than being lost.
 */
function groupByMonth(items: ForecastItem[], asOf: CivilDate, first: YearMonth): Map<YearMonth, ForecastItem[]> {
  const out = new Map<YearMonth, ForecastItem[]>();
  for (const item of items) {
    if (item.status === 'SKIPPED' || item.dueDate < asOf) continue;
    const month = maxMonth(monthOf(item.dueDate), first);
    out.set(month, [...(out.get(month) ?? []), item]);
  }
  return out;
}

function openingBuckets(snapshot: BalanceSnapshot, goals: Goal[]): Buckets {
  const saved = new Map(goals.map((g) => [g.id, dec(g.savedAmount)]));
  const balance = dec(snapshot.balance);
  return {
    all: balance,
    confirmed: balance,
    reserved: dec(snapshot.reservedAmount),
    free: balance.minus(snapshot.reservedAmount).minus(sum([...saved.values()])),
    saved,
  };
}

/** `balance = reserved + Σ goal.saved + free`, with free ≥ 0 at the snapshot (ADR-011). */
export function assertSnapshot(snapshot: BalanceSnapshot, goals: Goal[]): void {
  const earmarked = dec(snapshot.reservedAmount).plus(sum(goals.map((g) => dec(g.savedAmount))));
  if (dec(snapshot.reservedAmount).lt(0)) throw new SnapshotError('Reserved amount cannot be negative');
  if (earmarked.gt(dec(snapshot.balance))) {
    throw new SnapshotError(`Earmarks ${toMoney(earmarked)} exceed the balance ${snapshot.balance}`);
  }
}

function total(items: ForecastItem[], pick: (i: ForecastItem) => boolean): Dec {
  return sum(items.filter(pick).map((i) => dec(i.amount)));
}
