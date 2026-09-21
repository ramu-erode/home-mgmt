import type { CivilDate, Flow, Money } from '@home-mgmt/shared';
import { amountOn, InvalidFlowError, ruleDates } from '@home-mgmt/core';
import type { FlowAllocationRow, FlowAmountRow, FlowRow } from '../data/rows';
import { formatDate, monthName, ordinal } from '../format';

/** A flow with its live amounts and allocations — what list and editor show. */
export interface FlowView {
  flow: FlowRow;
  amounts: FlowAmountRow[];
  allocations: FlowAllocationRow[];
}

/** The engine's shape, for previews run on the phone (ADR-009: phones preview, the server materialises). */
export function toDomain(view: FlowView): Flow {
  const { version: _v, deletedAt: _d, ...flow } = view.flow;
  return {
    ...flow,
    amounts: view.amounts.map((a) => ({ effectiveFrom: a.effectiveFrom, amount: a.amount })),
    allocations: view.allocations.map((a) => ({ memberId: a.memberId, weight: a.weight })),
  };
}

/** "Every 4 months on the 20th", "Jun, Oct, Feb on the 5th", "Once on 1 May 2027". */
export function recurrenceSummary(flow: Pick<FlowRow, 'recurrenceKind' | 'freq' | 'interval' | 'months' | 'dayOfMonth' | 'startDate'>): string {
  const day = flow.dayOfMonth === 31 ? 'the last day' : `the ${ordinal(flow.dayOfMonth ?? 1)}`;
  switch (flow.recurrenceKind) {
    case 'ONE_OFF':
      return `Once, on ${formatDate(flow.startDate)}`;
    case 'MONTHS':
      return `${(flow.months ?? []).map(monthName).join(', ')} on ${day}`;
    case 'INTERVAL': {
      const n = flow.interval ?? 1;
      if (flow.freq === 'YEARLY') {
        const month = monthName(Number(flow.startDate.slice(5, 7)));
        return n === 1 ? `Yearly, ${month}, on ${day}` : `Every ${n} years, ${month}, on ${day}`;
      }
      return n === 1 ? `Monthly on ${day}` : `Every ${n} months on ${day}`;
    }
  }
}

export interface Preview {
  dates: { date: CivilDate; amount: Money }[];
  error: string | null;
}

/** The next `count` due dates from `from`, as the engine will produce them — or why it cannot. */
export function preview(flow: Flow, from: CivilDate, count = 6): Preview {
  try {
    const until = `${Number(from.slice(0, 4)) + 6}${from.slice(4)}` as CivilDate;
    const dates = ruleDates(flow, from, until).slice(0, count);
    return { dates: dates.map((date) => ({ date, amount: amountOn(flow, date) })), error: null };
  } catch (e) {
    return { dates: [], error: e instanceof InvalidFlowError ? e.message.replace(/^Flow [^:]+: /, '') : String(e) };
  }
}

/** The amount in force today, or the first scheduled one if none is in force yet. */
export function currentAmount(view: FlowView, today: CivilDate): Money | null {
  const sorted = [...view.amounts].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const inForce = sorted.filter((a) => a.effectiveFrom <= today).pop();
  return (inForce ?? sorted[0])?.amount ?? null;
}
