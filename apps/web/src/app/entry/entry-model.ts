import { isCivilDate, type CivilDate, type Money, type Uuid } from '@home-mgmt/shared';
import { subtractMoney, sumMoney } from '@home-mgmt/core';
import type { Write } from '../data/local-store';
import type { Draft, GoalRow } from '../data/rows';
import { parseMoney } from '../format';

/**
 * The three things a household enters by hand (Phase 6): where the money
 * stands, what it is saving towards, and income it expects. Pure — the screens
 * only collect text and show what comes back.
 */

// ---- Balance snapshot (ADR-011) --------------------------------------------------------

export interface SnapshotInput {
  asOf: string;
  balanceText: string;
  reservedText: string;
}

export interface SnapshotCheck {
  problems: string[];
  /** balance − reserved − Σ goal savings, when the numbers parse. */
  free: Money | null;
  goalsSaved: Money;
}

/**
 * balance = reserved + Σ goal.saved + free, with free ≥ 0. The engine refuses
 * a snapshot that breaks this, so the form refuses it first, with the sum shown.
 */
export function checkSnapshot(input: SnapshotInput, goals: Pick<GoalRow, 'savedAmount'>[]): SnapshotCheck {
  const problems: string[] = [];
  const balance = parseMoney(input.balanceText);
  const reserved = input.reservedText.trim() === '' ? ('0.00' as Money) : parseMoney(input.reservedText);
  const goalsSaved = sumMoney(goals.map((g) => g.savedAmount));
  if (!isCivilDate(input.asOf)) problems.push('Choose the date this balance is for.');
  if (!balance) problems.push('Enter the balance.');
  if (!reserved) problems.push('Enter what is already set aside for bills, or leave it empty.');
  if (!balance || !reserved) return { problems, free: null, goalsSaved };

  const free = subtractMoney(subtractMoney(balance, reserved), goalsSaved);
  if (free.startsWith('-')) problems.push('Set aside for bills plus saved towards goals is more than the balance.');
  return { problems, free, goalsSaved };
}

export function snapshotRow(id: Uuid, input: SnapshotInput): Draft<'balanceSnapshot'> {
  return {
    id,
    asOf: input.asOf as CivilDate,
    balance: parseMoney(input.balanceText) as Money,
    reservedAmount: input.reservedText.trim() === '' ? ('0.00' as Money) : (parseMoney(input.reservedText) as Money),
  };
}

// ---- Goals (ADR-011) --------------------------------------------------------------------

export interface GoalInput {
  id: Uuid;
  name: string;
  memberId: Uuid | null;
  targetText: string;
  targetDate: string;
  savedText: string;
  priority: number;
}

export function goalProblems(g: GoalInput): string[] {
  const out: string[] = [];
  const target = parseMoney(g.targetText);
  const saved = g.savedText.trim() === '' ? ('0.00' as Money) : parseMoney(g.savedText);
  if (!g.name.trim()) out.push('Give the goal a name.');
  if (!target || target === '0.00') out.push('Enter the target amount.');
  if (!saved) out.push('Saved so far must be an amount, or empty.');
  if (!isCivilDate(g.targetDate)) out.push('Choose a target date.');
  return out;
}

export function goalRow(g: GoalInput): Draft<'goal'> {
  return {
    id: g.id,
    name: g.name.trim(),
    memberId: g.memberId,
    targetAmount: parseMoney(g.targetText) as Money,
    targetDate: g.targetDate as CivilDate,
    savedAmount: g.savedText.trim() === '' ? ('0.00' as Money) : (parseMoney(g.savedText) as Money),
    priority: g.priority,
  };
}

/** "We put ₹10k in the car fund": the whole row again with the new total (whole-row LWW, ADR-009). */
export function addToSaved(goal: GoalRow, amountText: string): Draft<'goal'> | null {
  const amount = parseMoney(amountText);
  if (!amount || amount === '0.00') return null;
  const { version: _v, deletedAt: _d, ...row } = goal;
  return { ...row, savedAmount: sumMoney([goal.savedAmount, amount]) };
}

/**
 * Renumbers priorities 1…n after moving one goal a place — lower is funded
 * first. Returns only the rows whose priority changed.
 */
export function reprioritise(goals: GoalRow[], id: Uuid, by: -1 | 1): Draft<'goal'>[] {
  const list = [...goals];
  const i = list.findIndex((g) => g.id === id);
  if (i < 0 || !list[i + by]) return [];
  [list[i], list[i + by]] = [list[i + by], list[i]];
  return list
    .map((g, n) => ({ goal: g, priority: n + 1 }))
    .filter(({ goal, priority }) => goal.priority !== priority)
    .map(({ goal, priority }) => {
      const { version: _v, deletedAt: _d, ...row } = goal;
      return { ...row, priority };
    });
}

// ---- Expected contracting payment (ADR-010) ---------------------------------------------

export interface PaymentInput {
  client: string;
  amountText: string;
  expected: string;
  categoryId: Uuid | null;
  memberId: Uuid | null;
}

export function paymentProblems(p: PaymentInput): string[] {
  const out: string[] = [];
  if (!p.client.trim()) out.push('Who is paying?');
  const amount = parseMoney(p.amountText);
  if (!amount || amount === '0.00') out.push('Enter the amount.');
  if (!isCivilDate(p.expected)) out.push('When do you expect it?');
  return out;
}

/**
 * An expected payment is a ONE_OFF income flow (ADR-010): PLANNED until
 * confirmed, so the pessimistic cashflow line leaves it out until then.
 */
export function paymentWrites(p: PaymentInput, ids: { flow: Uuid; amount: Uuid; allocation: Uuid }): Write[] {
  const date = p.expected as CivilDate;
  const writes: Write[] = [
    {
      table: 'flow',
      draft: {
        id: ids.flow, name: p.client.trim(), categoryId: p.categoryId, direction: 'IN', recurrenceKind: 'ONE_OFF',
        freq: null, interval: null, months: null, dayOfMonth: null, startDate: date, endDate: null,
      },
    },
    { table: 'flowAmount', draft: { id: ids.amount, flowId: ids.flow, effectiveFrom: date, amount: parseMoney(p.amountText) as Money } },
  ];
  if (p.memberId) writes.push({ table: 'flowAllocation', draft: { id: ids.allocation, flowId: ids.flow, memberId: p.memberId, weight: 1 } });
  return writes;
}
