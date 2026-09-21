import type { CivilDate, ExpectedOccurrence, Money, Occurrence, Uuid } from '@home-mgmt/shared';

/**
 * Regeneration as a plan, not a side effect (ADR-003). The data layer applies
 * it inside the transaction that changed the flow (ADR-009).
 *
 * The invariant: only a row that is PLANNED and carries no override is ever
 * changed or removed. Everything else — CONFIRMED, SETTLED, SKIPPED, or any
 * override flag — is left exactly as it is.
 */
export interface ReconcilePlan {
  insert: ExpectedOccurrence[];
  updateAmount: { id: Uuid; amount: Money }[];
  /** Tombstone, never hard-delete (ADR-007). */
  softDelete: Uuid[];
}

export interface ReconcileScope {
  flowIds: Uuid[];
  from: CivilDate;
  to: CivilDate;
}

/**
 * @param expected  `project(flows, from, to)` for the flows in scope
 * @param existing  live (non-tombstoned) occurrences of those flows
 */
export function reconcile(scope: ReconcileScope, expected: ExpectedOccurrence[], existing: Occurrence[]): ReconcilePlan {
  const inScope = existing.filter((o) => isInScope(scope, o));
  const byKey = new Map(inScope.map((o) => [key(o), o]));
  const expectedKeys = new Set(expected.map(key));

  return {
    insert: expected.filter((e) => !byKey.has(key(e))),
    updateAmount: expected.flatMap((e) => amountChange(byKey.get(key(e)), e)),
    softDelete: inScope.filter((o) => !expectedKeys.has(key(o)) && isRegenerable(o)).map((o) => o.id),
  };
}

/** The whole of the ADR-003 invariant, in one place. */
export function isRegenerable(o: Occurrence): boolean {
  return o.status === 'PLANNED' && !o.isAmountOverridden && !o.isDateOverridden;
}

function amountChange(row: Occurrence | undefined, e: ExpectedOccurrence): { id: Uuid; amount: Money }[] {
  if (!row || !isRegenerable(row) || row.amount === e.amount) return [];
  return [{ id: row.id, amount: e.amount }];
}

function isInScope(scope: ReconcileScope, o: Occurrence): boolean {
  return scope.flowIds.includes(o.flowId) && o.ruleDate >= scope.from && o.ruleDate <= scope.to;
}

const key = (o: { flowId: Uuid; ruleDate: CivilDate }) => `${o.flowId}|${o.ruleDate}`;
