import { isCivilDate, type CivilDate, type Direction, type Flow, type Uuid } from '@home-mgmt/shared';
import type { Delete, Write } from '../data/local-store';
import type { Draft } from '../data/rows';
import { parseMoney } from '../format';
import type { FlowView } from './flow-model';

/**
 * The editor's working copy of a flow. Cadence is how a person thinks about it
 * — "monthly", "every 4 months", "June, October and February", "once" — and
 * maps onto the three recurrence kinds (ADR-013) only on save.
 */
export type Cadence = 'MONTHLY' | 'YEARLY' | 'MONTHS' | 'ONE_OFF';

export interface AmountDraft {
  id: Uuid;
  effectiveFrom: string;
  amountText: string;
}

export interface AllocationDraft {
  id: Uuid;
  memberId: Uuid;
  weight: number;
}

export interface FlowDraft {
  id: Uuid;
  isNew: boolean;
  name: string;
  categoryId: Uuid | null;
  direction: Direction;
  cadence: Cadence;
  interval: number;
  months: number[];
  dayOfMonth: number;
  startDate: string;
  endDate: string;
  amounts: AmountDraft[];
  /** 'household' = no allocation rows (ADR-010) — an explicit choice, never a default left blank. */
  split: 'household' | 'members';
  allocations: AllocationDraft[];
}

export function blankDraft(today: CivilDate): FlowDraft {
  return {
    id: crypto.randomUUID(),
    isNew: true,
    name: '',
    categoryId: null,
    direction: 'OUT',
    cadence: 'MONTHLY',
    interval: 1,
    months: [],
    dayOfMonth: Number(today.slice(8, 10)),
    startDate: today,
    endDate: '',
    amounts: [{ id: crypto.randomUUID(), effectiveFrom: today, amountText: '' }],
    split: 'household',
    allocations: [],
  };
}

export function draftFrom(view: FlowView): FlowDraft {
  const f = view.flow;
  const cadence: Cadence = f.recurrenceKind === 'INTERVAL' ? (f.freq === 'YEARLY' ? 'YEARLY' : 'MONTHLY') : f.recurrenceKind;
  return {
    id: f.id,
    isNew: false,
    name: f.name,
    categoryId: f.categoryId,
    direction: f.direction,
    cadence,
    interval: f.interval ?? 1,
    months: f.months ?? [],
    dayOfMonth: f.dayOfMonth ?? Number(f.startDate.slice(8, 10)),
    startDate: f.startDate,
    endDate: f.endDate ?? '',
    amounts: [...view.amounts]
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
      .map((a) => ({ id: a.id, effectiveFrom: a.effectiveFrom, amountText: a.amount })),
    split: view.allocations.length ? 'members' : 'household',
    allocations: view.allocations.map((a) => ({ id: a.id, memberId: a.memberId, weight: a.weight })),
  };
}

/** Everything wrong with the draft, in words a person can act on. Empty means savable. */
export function problems(d: FlowDraft): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push('Give it a name.');
  if (!isCivilDate(d.startDate)) out.push('Choose a start date.');
  if (d.endDate && (!isCivilDate(d.endDate) || d.endDate < d.startDate)) out.push('The end date must be on or after the start date.');
  if (d.cadence !== 'ONE_OFF' && !(d.dayOfMonth >= 1 && d.dayOfMonth <= 31)) out.push('The day of the month must be 1–31.');
  if ((d.cadence === 'MONTHLY' || d.cadence === 'YEARLY') && !(Number.isInteger(d.interval) && d.interval >= 1)) out.push('The interval must be a whole number, 1 or more.');
  if (d.cadence === 'MONTHS' && d.months.length === 0) out.push('Pick at least one month.');
  if (d.amounts.length === 0) out.push('Add an amount.');
  d.amounts.forEach((a, i) => {
    if (!parseMoney(a.amountText)) out.push(`Amount ${i + 1} is not a valid amount.`);
    if (!isCivilDate(a.effectiveFrom)) out.push(`Amount ${i + 1} needs a "from" date.`);
  });
  if (new Set(d.amounts.map((a) => a.effectiveFrom)).size !== d.amounts.length) out.push('Two amounts start on the same date.');
  if (d.split === 'members') {
    if (d.allocations.length === 0) out.push('Choose who this is for, or mark it Household.');
    if (d.allocations.some((a) => !(Number.isInteger(a.weight) && a.weight > 0))) out.push('Shares must be whole numbers, 1 or more.');
    if (new Set(d.allocations.map((a) => a.memberId)).size !== d.allocations.length) out.push('Someone is listed twice.');
  }
  return out;
}

export interface FlowRows {
  flow: Draft<'flow'>;
  amounts: Draft<'flowAmount'>[];
  allocations: Draft<'flowAllocation'>[];
}

/** The rows a valid draft saves as. Call only when `problems(d)` is empty. */
export function toRows(d: FlowDraft): FlowRows {
  const interval = d.cadence === 'MONTHLY' || d.cadence === 'YEARLY';
  const flow: Draft<'flow'> = {
    id: d.id,
    name: d.name.trim(),
    categoryId: d.categoryId,
    direction: d.direction,
    recurrenceKind: interval ? 'INTERVAL' : d.cadence === 'MONTHS' ? 'MONTHS' : 'ONE_OFF',
    freq: interval ? (d.cadence === 'YEARLY' ? 'YEARLY' : 'MONTHLY') : null,
    interval: interval ? d.interval : null,
    months: d.cadence === 'MONTHS' ? [...d.months].sort((a, b) => a - b) : null,
    dayOfMonth: d.cadence === 'ONE_OFF' ? null : d.dayOfMonth,
    startDate: d.startDate as CivilDate,
    endDate: d.cadence === 'ONE_OFF' || !d.endDate ? null : (d.endDate as CivilDate),
  };
  const amounts = d.amounts.map((a) => ({ id: a.id, flowId: d.id, effectiveFrom: a.effectiveFrom as CivilDate, amount: parseMoney(a.amountText)! }));
  const allocations = d.split === 'household' ? [] : d.allocations.map((a) => ({ id: a.id, flowId: d.id, memberId: a.memberId, weight: a.weight }));
  return { flow, amounts, allocations };
}

/** The engine's shape, for the live preview. */
export function toFlow(d: FlowDraft): Flow {
  const { flow, amounts, allocations } = toRows(d);
  return { ...flow, amounts, allocations };
}

/**
 * What to write and tombstone to turn `original` into `rows`. The flow comes
 * first in the outbox, so its amounts and allocations never arrive before it.
 */
export function changes(original: FlowView | null, rows: FlowRows): { writes: Write[]; deletes: Delete[] } {
  const amountIds = new Set(rows.amounts.map((a) => a.id));
  const allocationIds = new Set(rows.allocations.map((a) => a.id));
  return {
    writes: [
      { table: 'flow', draft: rows.flow },
      ...rows.amounts.map((draft): Write => ({ table: 'flowAmount', draft })),
      ...rows.allocations.map((draft): Write => ({ table: 'flowAllocation', draft })),
    ],
    deletes: [
      ...(original?.amounts ?? []).filter((a) => !amountIds.has(a.id)).map((a) => ({ table: 'flowAmount' as const, id: a.id })),
      ...(original?.allocations ?? []).filter((a) => !allocationIds.has(a.id)).map((a) => ({ table: 'flowAllocation' as const, id: a.id })),
    ],
  };
}

/**
 * A copy for another person — per-person fees are per-person flows (ADR-010).
 * "Swimming — Child 1" becomes "Swimming — Child 2"; the copy is 100% theirs.
 */
export function duplicateFor(view: FlowView, memberId: Uuid, memberName: string): FlowDraft {
  const d = draftFrom(view);
  const base = d.name.split(' — ')[0];
  return {
    ...d,
    id: crypto.randomUUID(),
    isNew: true,
    name: `${base} — ${memberName}`,
    amounts: d.amounts.map((a) => ({ ...a, id: crypto.randomUUID() })),
    split: 'members',
    allocations: [{ id: crypto.randomUUID(), memberId, weight: 1 }],
  };
}
