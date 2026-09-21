import type { CivilDate, Direction, Occurrence } from '@home-mgmt/shared';
import { addMonths, dayInMonth, InvalidFlowError, monthOf, project, reconcile } from '@home-mgmt/core';
import type { FlowRow, OccurrenceRow } from '../data/rows';
import { toDomain, type FlowView } from '../flows/flow-model';

/**
 * What the forecast runs on, on the phone (ADR-009: the server materialises,
 * phones preview).
 *
 * - A flow with no unsynced change: its occurrences exactly as the Mac
 *   materialised them.
 * - A flow with an unsynced change (or created on this phone and never seen by
 *   the Mac): what the Mac *will* produce — the same `project` + `reconcile`,
 *   applied in memory to the rows the phone has. Confirmed, settled, skipped
 *   and overridden rows survive exactly as they would on the server.
 */
export interface ForecastOccurrence {
  /** The row id, or `preview:<flow>:<date>` for one the Mac has not made yet. */
  id: string;
  flowId: string;
  direction: Direction;
  ruleDate: CivilDate;
  dueDate: CivilDate;
  amount: Occurrence['amount'];
  status: Occurrence['status'];
  isAmountOverridden: boolean;
  isDateOverridden: boolean;
  note: string | null;
  /** Not yet materialised by the Mac — commands on it must wait for a sync. */
  preview: boolean;
}

export interface ForecastSource {
  /** Every flow row, tombstoned ones included — settled history of a deleted flow still counts. */
  flowRows: FlowRow[];
  /** Live flows with live amounts and allocations. */
  flows: FlowView[];
  /** Live occurrences. */
  occurrences: OccurrenceRow[];
  /** Flows whose rule or amounts have changes still in the outbox. */
  pendingFlowIds: ReadonlySet<string>;
  today: CivilDate;
}

/** The server's materialisation window (ADR-003): this month plus seventeen. */
export function horizon(today: CivilDate, months = 18): { from: CivilDate; to: CivilDate } {
  const first = monthOf(today);
  return { from: `${first}-01` as CivilDate, to: dayInMonth(addMonths(first, months - 1), 31) };
}

export function forecastItems(src: ForecastSource): ForecastOccurrence[] {
  const direction = new Map(src.flowRows.map((f) => [f.id, f.direction]));
  // A tombstoned flow is always re-derived: its PLANNED rows go, its history
  // stays — even if it was deleted by a path that skipped regeneration.
  const rederive = new Set([...src.pendingFlowIds, ...src.flowRows.filter((f) => f.deletedAt !== null).map((f) => f.id)]);
  const out: ForecastOccurrence[] = [];

  for (const o of src.occurrences) {
    const dir = direction.get(o.flowId);
    if (dir && !rederive.has(o.flowId)) out.push(fromRow(o, dir));
  }
  for (const flowId of rederive) {
    const dir = direction.get(flowId);
    if (dir) out.push(...previewFlow(flowId, dir, src));
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.flowId.localeCompare(b.flowId));
}

function previewFlow(flowId: string, dir: Direction, src: ForecastSource): ForecastOccurrence[] {
  const rows = src.occurrences.filter((o) => o.flowId === flowId);
  const existing: Occurrence[] = rows.map((o) => ({ ...o, direction: dir }));
  const view = src.flows.find((f) => f.flow.id === flowId);
  const { from, to } = horizon(src.today);

  let expected;
  try {
    // A deleted flow expands to nothing, exactly as on the server.
    expected = view ? project([toDomain(view)], from, to) : [];
  } catch (e) {
    // Not expandable yet (e.g. no amount in force): the server leaves its rows alone, so do we.
    if (e instanceof InvalidFlowError) return rows.map((o) => fromRow(o, dir));
    throw e;
  }

  const plan = reconcile({ flowIds: [flowId], from, to }, expected, existing);
  const removed = new Set(plan.softDelete);
  const amounts = new Map(plan.updateAmount.map((u) => [u.id, u.amount]));
  return [
    ...rows.filter((o) => !removed.has(o.id)).map((o) => ({ ...fromRow(o, dir), amount: amounts.get(o.id) ?? o.amount })),
    ...plan.insert.map((e) => ({
      id: `preview:${e.flowId}:${e.ruleDate}`,
      flowId: e.flowId,
      direction: dir,
      ruleDate: e.ruleDate,
      dueDate: e.ruleDate,
      amount: e.amount,
      status: 'PLANNED' as const,
      isAmountOverridden: false,
      isDateOverridden: false,
      note: null,
      preview: true,
    })),
  ];
}

function fromRow(o: OccurrenceRow, direction: Direction): ForecastOccurrence {
  return {
    id: o.id,
    flowId: o.flowId,
    direction,
    ruleDate: o.ruleDate,
    dueDate: o.dueDate,
    amount: o.amount,
    status: o.status,
    isAmountOverridden: o.isAmountOverridden,
    isDateOverridden: o.isDateOverridden,
    note: o.note,
    preview: false,
  };
}
