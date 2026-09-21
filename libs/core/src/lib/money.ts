import Big from 'big.js';
import { money, type Money, type Uuid, type FlowAllocation } from '@home-mgmt/shared';

/**
 * Exact decimal arithmetic for the engine (ADR-012).
 *
 * `D` is a private constructor: big.js keeps DP and RM on the constructor, and
 * the global one is shared with anything else that imports big.js. Nothing
 * outside this library ever sees a Big — values enter as Money strings and
 * leave as Money strings.
 */
export const D = Big();
D.DP = 10;
D.RM = Big.roundHalfUp;

export type Dec = Big;

export const ZERO = D(0);

export function dec(value: Money): Dec {
  return D(value);
}

/** Half-up to paise — the display/storage rounding point. */
export function toMoney(value: Dec): Money {
  return money(value.toFixed(2, Big.roundHalfUp));
}

/** Up to the whole rupee — the reserve and goal rounding point (ADR-011). */
export function ceilRupee(value: Dec): Dec {
  return value.round(0, Big.roundUp);
}

export function sum(values: Dec[]): Dec {
  return values.reduce((acc, v) => acc.plus(v), ZERO);
}

export function minDec(a: Dec, b: Dec): Dec {
  return a.lt(b) ? a : b;
}

export function maxDec(a: Dec, b: Dec): Dec {
  return a.gt(b) ? a : b;
}

/** Exact Money arithmetic for callers outside the engine, which never see a Big (ADR-012). */
export function addMoney(a: Money, b: Money): Money {
  return toMoney(dec(a).plus(dec(b)));
}

export function subtractMoney(a: Money, b: Money): Money {
  return toMoney(dec(a).minus(dec(b)));
}

export function sumMoney(values: Money[]): Money {
  return toMoney(sum(values.map(dec)));
}

export interface Share {
  /** `null` is the household bucket (ADR-010). */
  memberId: Uuid | null;
  amount: Money;
}

/**
 * Splits an amount by weight so the shares sum to it exactly — largest
 * remainder: every share is floored to paise, then the leftover paise go to
 * the largest fractional remainders. Ties go to the higher weight, then the
 * lower memberId, so the result is deterministic.
 *
 * No allocations means household-general: one share with memberId `null`.
 */
export function split(amount: Money, allocations: FlowAllocation[]): Share[] {
  if (allocations.length === 0) return [{ memberId: null, amount }];
  assertWeights(allocations);

  const paise = dec(amount).times(100);
  const totalWeight = sum(allocations.map((a) => D(a.weight)));
  const exact = allocations.map((a) => paise.times(a.weight).div(totalWeight));
  const floors = exact.map((e) => e.round(0, Big.roundDown));
  const leftover = paise.minus(sum(floors)).toNumber();

  const bonus = rankByRemainder(allocations, exact, floors).slice(0, leftover);
  return allocations.map((a, i) => ({
    memberId: a.memberId,
    amount: toMoney(floors[i].plus(bonus.includes(i) ? 1 : 0).div(100)),
  }));
}

function assertWeights(allocations: FlowAllocation[]): void {
  for (const a of allocations) {
    if (!(a.weight > 0)) throw new RangeError(`Allocation weight must be positive, got ${a.weight}`);
  }
}

function rankByRemainder(allocations: FlowAllocation[], exact: Dec[], floors: Dec[]): number[] {
  return allocations
    .map((a, i) => ({ i, remainder: exact[i].minus(floors[i]), weight: a.weight, memberId: a.memberId }))
    .sort((x, y) => y.remainder.cmp(x.remainder) || y.weight - x.weight || x.memberId.localeCompare(y.memberId))
    .map((r) => r.i);
}
