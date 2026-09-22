import { sql, type RawBuilder } from 'kysely';
import type { Database } from './database';

/**
 * The tombstone purge (ADR-007, ADR-009) — the only code that hard-deletes.
 *
 * A tombstone older than the cutoff is removed unless a row that stays still
 * references it: a deleted flow keeps its settled history, so the flow row must
 * outlive that history; a removed member stays while an allocation, goal or
 * device still names them. Tables are purged children-first so a parent becomes
 * unreferenced in the same run.
 *
 * Every purged row's version raises `min_retained_version`. A phone whose
 * cursor is below it never saw some tombstone that is now gone, so its next pull
 * answers `resetRequired` and it re-pulls from zero instead of keeping the row.
 */
export interface PurgeResult {
  deleted: Record<string, number>;
  minRetainedVersion: string;
}

/** Tables that carry `updated_by_device`, for the device reference check. */
const AUDITED = ['member', 'device', 'category', 'flow', 'flow_amount', 'flow_allocation', 'occurrence', 'balance_snapshot', 'goal'];

const unreferencedDevice = sql.raw(AUDITED.map((t) => `NOT EXISTS (SELECT 1 FROM ${t} r WHERE r.updated_by_device = x.id AND r.id <> x.id)`).join(' AND '));

/** Children first. Category runs twice: a child's delete is what frees its parent. */
const STEPS: { table: string; unreferenced: RawBuilder<unknown> | null }[] = [
  { table: 'occurrence', unreferenced: null },
  { table: 'flow_allocation', unreferenced: null },
  { table: 'flow_amount', unreferenced: null },
  { table: 'goal', unreferenced: null },
  { table: 'balance_snapshot', unreferenced: null },
  {
    table: 'flow',
    unreferenced: sql`NOT EXISTS (SELECT 1 FROM occurrence r WHERE r.flow_id = x.id)
      AND NOT EXISTS (SELECT 1 FROM flow_amount r WHERE r.flow_id = x.id)
      AND NOT EXISTS (SELECT 1 FROM flow_allocation r WHERE r.flow_id = x.id)`,
  },
  { table: 'category', unreferenced: sql`NOT EXISTS (SELECT 1 FROM flow r WHERE r.category_id = x.id) AND NOT EXISTS (SELECT 1 FROM category r WHERE r.parent_id = x.id)` },
  { table: 'category', unreferenced: sql`NOT EXISTS (SELECT 1 FROM flow r WHERE r.category_id = x.id) AND NOT EXISTS (SELECT 1 FROM category r WHERE r.parent_id = x.id)` },
  {
    table: 'member',
    unreferenced: sql`NOT EXISTS (SELECT 1 FROM device r WHERE r.member_id = x.id)
      AND NOT EXISTS (SELECT 1 FROM flow_allocation r WHERE r.member_id = x.id)
      AND NOT EXISTS (SELECT 1 FROM goal r WHERE r.member_id = x.id)`,
  },
  { table: 'device', unreferenced: unreferencedDevice },
];

export async function purgeTombstones(db: Database, cutoff: Date): Promise<PurgeResult> {
  return db.transaction().execute(async (tx) => {
    // The one switch that lets refuse_hard_delete() through, for this transaction only.
    await sql`SET LOCAL homemgmt.purge = 'on'`.execute(tx);

    const deleted: Record<string, number> = {};
    let highest = 0n;
    for (const { table, unreferenced } of STEPS) {
      const guard = unreferenced ? sql`AND ${unreferenced}` : sql``;
      const r = await sql<{ version: string }>`
        DELETE FROM ${sql.table(table)} x
        WHERE x.deleted_at IS NOT NULL AND x.deleted_at < ${cutoff} ${guard}
        RETURNING x.version`.execute(tx);
      deleted[table] = (deleted[table] ?? 0) + r.rows.length;
      for (const row of r.rows) if (BigInt(row.version) > highest) highest = BigInt(row.version);
    }

    const { rows } = await sql<{ minRetainedVersion: string }>`
      UPDATE sync_state SET min_retained_version = GREATEST(min_retained_version, ${highest.toString()}::bigint)
      RETURNING min_retained_version`.execute(tx);
    return { deleted, minRetainedVersion: rows[0].minRetainedVersion };
  });
}
