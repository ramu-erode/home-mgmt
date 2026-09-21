import { sql, type UpdateQueryBuilder, type UpdateResult } from 'kysely';
import type { BalanceSnapshot, CivilDate, Direction, Flow, ForecastItem, Freq, Goal, Money, Occurrence, OccurrenceStatus, RecurrenceKind, Uuid } from '@home-mgmt/shared';
import type { OccurrenceState, ReconcilePlan } from '@home-mgmt/core';
import type { Database, Tx } from './database';
import type { DB } from './schema';

/**
 * Reads and writes for materialisation (ADR-003, ADR-009) and the forecast.
 * Everything here maps between database rows and the engine's domain shapes;
 * the decisions are made in libs/core.
 */

/** Live flows with their live amounts and allocations, as the engine wants them. */
export async function loadFlows(tx: Tx | Database, flowIds?: Uuid[]): Promise<Flow[]> {
  if (flowIds?.length === 0) return [];
  let query = tx.selectFrom('flow').selectAll().where('deletedAt', 'is', null);
  if (flowIds) query = query.where('id', 'in', flowIds);
  const flows = await query.execute();
  if (flows.length === 0) return [];

  const ids = flows.map((f) => f.id);
  const amounts = await tx.selectFrom('flowAmount').select(['flowId', 'effectiveFrom', 'amount']).where('flowId', 'in', ids).where('deletedAt', 'is', null).execute();
  const allocations = await tx.selectFrom('flowAllocation').select(['flowId', 'memberId', 'weight']).where('flowId', 'in', ids).where('deletedAt', 'is', null).execute();

  return flows.map((f) => ({
    id: f.id,
    name: f.name,
    categoryId: f.categoryId,
    direction: f.direction as Direction,
    recurrenceKind: f.recurrenceKind as RecurrenceKind,
    freq: f.freq as Freq | null,
    interval: f.interval,
    months: f.months,
    dayOfMonth: f.dayOfMonth,
    startDate: f.startDate as CivilDate,
    endDate: f.endDate as CivilDate | null,
    amounts: amounts.filter((a) => a.flowId === f.id).map((a) => ({ effectiveFrom: a.effectiveFrom as CivilDate, amount: a.amount as Money })),
    allocations: allocations.filter((a) => a.flowId === f.id).map((a) => ({ memberId: a.memberId, weight: a.weight })),
  }));
}

export async function liveFlowIds(db: Database): Promise<Uuid[]> {
  return (await db.selectFrom('flow').select('id').where('deletedAt', 'is', null).execute()).map((r) => r.id);
}

/** Live occurrences of the given flows, in the engine's shape. */
export async function liveOccurrences(tx: Tx, flowIds: Uuid[]): Promise<Occurrence[]> {
  if (flowIds.length === 0) return [];
  const rows = await tx
    .selectFrom('occurrence as o')
    .innerJoin('flow as f', 'f.id', 'o.flowId')
    .select(['o.id', 'o.flowId', 'f.direction', 'o.ruleDate', 'o.dueDate', 'o.amount', 'o.status', 'o.isAmountOverridden', 'o.isDateOverridden'])
    .where('o.flowId', 'in', flowIds)
    .where('o.deletedAt', 'is', null)
    .execute();
  return rows.map((r) => ({
    ...r,
    direction: r.direction as Direction,
    ruleDate: r.ruleDate as CivilDate,
    dueDate: r.dueDate as CivilDate,
    amount: r.amount as Money,
    status: r.status as OccurrenceStatus,
  }));
}

/**
 * Applies a reconcile plan. The WHERE clauses restate the ADR-003 invariant so
 * that even a wrong plan cannot touch a confirmed, settled, skipped or
 * overridden row.
 */
export async function applyPlan(tx: Tx, plan: ReconcilePlan): Promise<void> {
  const now = new Date().toISOString();
  if (plan.insert.length > 0) {
    await tx
      .insertInto('occurrence')
      .values(plan.insert.map((e) => ({ flowId: e.flowId, ruleDate: e.ruleDate, dueDate: e.ruleDate, amount: e.amount, clientUpdatedAt: now })))
      .execute();
  }
  for (const u of plan.updateAmount) {
    await regenerable(tx.updateTable('occurrence').set({ amount: u.amount, clientUpdatedAt: now }).where('id', '=', u.id)).execute();
  }
  if (plan.softDelete.length > 0) {
    await regenerable(tx.updateTable('occurrence').set({ deletedAt: sql`now()`, clientUpdatedAt: now }).where('id', 'in', plan.softDelete)).execute();
  }
}

function regenerable(q: UpdateQueryBuilder<DB, 'occurrence', 'occurrence', UpdateResult>) {
  return q
    .where('status', '=', 'PLANNED')
    .where('isAmountOverridden', '=', false)
    .where('isDateOverridden', '=', false)
    .where('deletedAt', 'is', null);
}

/** Locks the row for a command and returns it in the command's shape, or null if it never existed. */
export async function lockOccurrence(tx: Tx, id: Uuid): Promise<OccurrenceState | null> {
  const r = await tx.selectFrom('occurrence').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!r) return null;
  return {
    status: r.status as OccurrenceStatus,
    amount: r.amount as Money,
    dueDate: r.dueDate as CivilDate,
    isAmountOverridden: r.isAmountOverridden,
    isDateOverridden: r.isDateOverridden,
    settledOn: r.settledOn as CivilDate | null,
    settledAmount: r.settledAmount as Money | null,
    note: r.note,
    deleted: r.deletedAt !== null,
  };
}

export async function patchOccurrence(tx: Tx, id: Uuid, patch: Partial<OccurrenceState>, clientUpdatedAt: string, deviceId: Uuid): Promise<void> {
  const columns = { ...patch };
  delete columns.deleted; // not a column — tombstoning is regeneration's job
  await tx.updateTable('occurrence').set({ ...columns, clientUpdatedAt, updatedByDevice: deviceId }).where('id', '=', id).execute();
}

/** Everything the forecast reads: live occurrences due on or after `from`, the latest snapshot, live goals. */
export async function forecastInputs(db: Database, from: CivilDate): Promise<{ items: ForecastItem[]; snapshot: BalanceSnapshot | null; goals: Goal[] }> {
  const rows = await db
    .selectFrom('occurrence as o')
    .innerJoin('flow as f', 'f.id', 'o.flowId')
    .select(['o.flowId', 'f.direction', 'o.dueDate', 'o.amount', 'o.status'])
    .where('o.deletedAt', 'is', null)
    .where('o.dueDate', '>=', from)
    .execute();
  const snapshot = await db.selectFrom('balanceSnapshot').select(['asOf', 'balance', 'reservedAmount']).where('deletedAt', 'is', null).orderBy('asOf', 'desc').limit(1).executeTakeFirst();
  const goals = await db.selectFrom('goal').select(['id', 'name', 'memberId', 'targetAmount', 'targetDate', 'savedAmount', 'priority']).where('deletedAt', 'is', null).execute();

  return {
    items: rows.map((r) => ({ flowId: r.flowId, direction: r.direction as Direction, dueDate: r.dueDate as CivilDate, amount: r.amount as Money, status: r.status as OccurrenceStatus })),
    snapshot: snapshot ? { asOf: snapshot.asOf as CivilDate, balance: snapshot.balance as Money, reservedAmount: snapshot.reservedAmount as Money } : null,
    goals: goals.map((g) => ({ ...g, targetAmount: g.targetAmount as Money, targetDate: g.targetDate as CivilDate, savedAmount: g.savedAmount as Money })),
  };
}
