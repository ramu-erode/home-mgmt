import { sql, type Kysely } from 'kysely';
import type { PullTable, SyncRow, SyncTable, Uuid } from '@home-mgmt/shared';
import type { Database, Tx } from './database';

/**
 * Last-write-wins persistence for human-authored tables (ADR-009), and the
 * delta pull. Table names arrive from the validated operation, so the builder
 * is used untyped here — the one place that does so.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- table chosen at runtime from a validated operation
type Untyped = Kysely<any>;
const untyped = (tx: Tx | Database) => tx as unknown as Untyped;

export type WriteOutcome = 'applied' | 'stale';

/** The placeholder loses to any real write, so the phone's own upsert names it. */
const EPOCH = '1970-01-01T00:00:00.000Z';

/**
 * A phone's first push may reference its device before the device row exists;
 * register it rather than fail every operation on the foreign key.
 */
export async function ensureDevice(tx: Tx, deviceId: Uuid): Promise<void> {
  await tx
    .insertInto('device')
    .values({ id: deviceId, name: 'New device', clientUpdatedAt: EPOCH })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
}

/**
 * Inserts, or replaces the whole row if the incoming `clientUpdatedAt` is
 * newer. An upsert also clears `deletedAt`: an edit made after a delete wins,
 * exactly as a delete made after an edit does.
 */
export async function upsertLww(tx: Tx, table: SyncTable, row: { id: Uuid } & Record<string, unknown>, clientUpdatedAt: string, deviceId: Uuid): Promise<WriteOutcome> {
  const values: Record<string, unknown> = { ...row, clientUpdatedAt, updatedByDevice: deviceId, deletedAt: null };
  const columns = Object.keys(values).filter((c) => c !== 'id');
  const written = await untyped(tx)
    .insertInto(table)
    .values(values)
    .onConflict((oc) =>
      oc
        .column('id')
        .doUpdateSet((eb) => Object.fromEntries(columns.map((c) => [c, eb.ref(`excluded.${c}`)])))
        .where((eb) => eb(eb.ref(`${table}.clientUpdatedAt`), '<', eb.ref('excluded.clientUpdatedAt'))),
    )
    .returning('id')
    .executeTakeFirst();
  return written ? 'applied' : 'stale';
}

/** Tombstones a row under the same rule. Deleting what is absent or already deleted is a no-op. */
export async function softDeleteLww(tx: Tx, table: SyncTable, id: Uuid, clientUpdatedAt: string, deviceId: Uuid): Promise<WriteOutcome> {
  const current = await untyped(tx).selectFrom(table).select(['clientUpdatedAt', 'deletedAt']).where('id', '=', id).forUpdate().executeTakeFirst();
  if (!current || current.deletedAt) return 'applied';
  if (new Date(current.clientUpdatedAt as Date).getTime() >= Date.parse(clientUpdatedAt)) return 'stale';
  await untyped(tx)
    .updateTable(table)
    .set({ deletedAt: sql`now()`, clientUpdatedAt, updatedByDevice: deviceId })
    .where('id', '=', id)
    .execute();
  return 'applied';
}

/** Deleting a flow deletes its schedule and split with it; its occurrences are regeneration's job. */
export async function cascadeFlowDelete(tx: Tx, flowId: Uuid, clientUpdatedAt: string, deviceId: Uuid): Promise<void> {
  for (const table of ['flowAmount', 'flowAllocation'] as const) {
    await tx
      .updateTable(table)
      .set({ deletedAt: sql`now()`, clientUpdatedAt, updatedByDevice: deviceId })
      .where('flowId', '=', flowId)
      .where('deletedAt', 'is', null)
      .execute();
  }
}

/** Live or tombstoned — callers checking a reference decide what a tombstone means. */
export async function findRow(tx: Tx, table: SyncTable, id: Uuid): Promise<Record<string, unknown> | undefined> {
  return untyped(tx).selectFrom(table).selectAll().where('id', '=', id).executeTakeFirst();
}

const PULL_TABLES: PullTable[] = ['member', 'device', 'category', 'flow', 'flowAmount', 'flowAllocation', 'occurrence', 'balanceSnapshot', 'goal'];

export type PullResult = { resetRequired: true } | { resetRequired: false; cursor: string; changes: Partial<Record<PullTable, SyncRow[]>> };

/**
 * Every row with `version > since`, tombstones included (ADR-007), read in one
 * repeatable-read snapshot so all tables agree. Versions commit in order (the
 * trigger's advisory lock), so the highest version seen is a safe cursor.
 */
export async function pull(db: Database, since: bigint): Promise<PullResult> {
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (tx) => {
      const { minRetainedVersion } = await tx.selectFrom('syncState').select('minRetainedVersion').executeTakeFirstOrThrow();
      if (since > 0n && since < BigInt(minRetainedVersion)) return { resetRequired: true } as const;

      let cursor = since;
      const changes: Partial<Record<PullTable, SyncRow[]>> = {};
      for (const table of PULL_TABLES) {
        const rows = (await untyped(tx).selectFrom(table).selectAll().where('version', '>', since.toString()).orderBy('version').execute()) as SyncRow[];
        if (rows.length === 0) continue;
        changes[table] = rows;
        const last = BigInt(rows[rows.length - 1].version);
        if (last > cursor) cursor = last;
      }
      return { resetRequired: false, cursor: cursor.toString(), changes } as const;
    });
}
