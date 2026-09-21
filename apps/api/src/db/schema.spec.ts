import { sql, type Transaction } from 'kysely';
import { createTestDatabase, hasDatabase } from '../testing/test-app';
import { createDatabase, type Database } from './database';
import type { DB } from './schema';

/**
 * Integration tests for the guarantees the schema itself enforces, against a
 * fresh clone of the migrated test template. Every test also runs in a
 * transaction that is rolled back.
 */
const suite = hasDatabase ? describe : describe.skip;

class Rollback extends Error {}

suite('schema (integration)', () => {
  let db: Database;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const test = await createTestDatabase();
    drop = test.drop;
    db = createDatabase(test.url, 2);
  });
  afterAll(async () => {
    await db.destroy();
    await drop();
  });

  /** Runs `fn` in a transaction and always rolls it back. */
  async function inRollback(fn: (tx: Transaction<DB>) => Promise<void>): Promise<void> {
    await db
      .transaction()
      .execute(async (tx) => {
        await fn(tx);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  }

  async function aFlow(tx: Transaction<DB>): Promise<string> {
    const { id } = await tx
      .insertInto('flow')
      .values({ name: 'Test', direction: 'OUT', recurrenceKind: 'INTERVAL', freq: 'MONTHLY', interval: 1, dayOfMonth: 1, startDate: '2026-01-01' })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  /** Runs `fn` under a savepoint and returns the error message it raised, if any. */
  async function failure(tx: Transaction<DB>, fn: () => Promise<unknown>): Promise<string | null> {
    await sql`SAVEPOINT probe`.execute(tx);
    try {
      await fn();
      await sql`RELEASE SAVEPOINT probe`.execute(tx);
      return null;
    } catch (e) {
      await sql`ROLLBACK TO SAVEPOINT probe`.execute(tx);
      return e instanceof Error ? e.message : String(e);
    }
  }

  describe('sync columns (ADR-009)', () => {
    it('stamps version on insert and advances it on every update, whatever the caller sends', () =>
      inRollback(async (tx) => {
        const { id, version: v1 } = await tx.insertInto('member').values({ name: 'A', version: 999999 }).returning(['id', 'version']).executeTakeFirstOrThrow();
        expect(v1).not.toBe('999999');
        const { version: v2 } = await tx.updateTable('member').set({ name: 'B' }).where('id', '=', id).returning('version').executeTakeFirstOrThrow();
        expect(BigInt(v2)).toBeGreaterThan(BigInt(v1));
      }));
  });

  describe('tombstones (ADR-007)', () => {
    it('refuses a hard DELETE', () =>
      inRollback(async (tx) => {
        const { id } = await tx.insertInto('member').values({ name: 'A' }).returning('id').executeTakeFirstOrThrow();
        expect(await failure(tx, () => tx.deleteFrom('member').where('id', '=', id).execute())).toMatch(/hard DELETE on member is not allowed/);
      }));

    it('allows it only inside the purge job', () =>
      inRollback(async (tx) => {
        const { id } = await tx.insertInto('member').values({ name: 'A' }).returning('id').executeTakeFirstOrThrow();
        await sql`SET LOCAL homemgmt.purge = 'on'`.execute(tx);
        const r = await tx.deleteFrom('member').where('id', '=', id).executeTakeFirst();
        expect(r.numDeletedRows).toBe(1n);
      }));

    it('a tombstoned occurrence does not block regenerating its date; a live duplicate is rejected', () =>
      inRollback(async (tx) => {
        const flowId = await aFlow(tx);
        const row = { flowId, ruleDate: '2026-10-01', dueDate: '2026-10-01', amount: '1000.00' };
        const { id } = await tx.insertInto('occurrence').values(row).returning('id').executeTakeFirstOrThrow();
        expect(await failure(tx, () => tx.insertInto('occurrence').values(row).execute())).toMatch(/uq_occurrence/);
        await tx.updateTable('occurrence').set({ deletedAt: sql`now()` }).where('id', '=', id).execute();
        expect(await failure(tx, () => tx.insertInto('occurrence').values(row).execute())).toBeNull();
      }));
  });

  describe('flow rules (ADR-013)', () => {
    it.each([
      ['INTERVAL carrying months', { recurrenceKind: 'INTERVAL', freq: 'MONTHLY', interval: 1, dayOfMonth: 1, months: [6] }],
      ['INTERVAL without freq', { recurrenceKind: 'INTERVAL', interval: 1, dayOfMonth: 1 }],
      ['MONTHS without months', { recurrenceKind: 'MONTHS', dayOfMonth: 5 }],
      ['MONTHS with month 13', { recurrenceKind: 'MONTHS', months: [13], dayOfMonth: 5 }],
      ['ONE_OFF with a day', { recurrenceKind: 'ONE_OFF', dayOfMonth: 5 }],
      ['day 32', { recurrenceKind: 'INTERVAL', freq: 'MONTHLY', interval: 1, dayOfMonth: 32 }],
    ])('rejects %s', (_, fields) =>
      inRollback(async (tx) => {
        const values = { name: 'Bad', direction: 'OUT', startDate: '2026-01-01', ...fields };
        expect(await failure(tx, () => tx.insertInto('flow').values(values as never).execute())).not.toBeNull();
      }));
  });

  describe('occurrence integrity (ADR-003)', () => {
    it('a due date may differ from the rule date only when flagged as overridden', () =>
      inRollback(async (tx) => {
        const flowId = await aFlow(tx);
        const moved = { flowId, ruleDate: '2026-10-01', dueDate: '2026-10-05', amount: '1000.00' };
        expect(await failure(tx, () => tx.insertInto('occurrence').values(moved).execute())).toMatch(/occurrence_date_override/);
        expect(await failure(tx, () => tx.insertInto('occurrence').values({ ...moved, isDateOverridden: true }).execute())).toBeNull();
      }));

    it('SETTLED exactly when a settlement is recorded', () =>
      inRollback(async (tx) => {
        const flowId = await aFlow(tx);
        const base = { flowId, dueDate: '2026-10-01', amount: '1000.00' };
        expect(await failure(tx, () => tx.insertInto('occurrence').values({ ...base, ruleDate: '2026-10-01', status: 'SETTLED' }).execute())).toMatch(/occurrence_settlement/);
        expect(await failure(tx, () => tx.insertInto('occurrence').values({ ...base, ruleDate: '2026-10-01', settledOn: '2026-10-02', settledAmount: '1000.00' }).execute())).toMatch(/occurrence_settlement/);
      }));
  });

  describe('value types at the driver (ADR-012, ADR-013)', () => {
    it('returns dates as YYYY-MM-DD strings and money as exact decimal strings', () =>
      inRollback(async (tx) => {
        const flowId = await aFlow(tx);
        await tx.insertInto('flowAmount').values({ flowId, effectiveFrom: '2026-06-01', amount: '1234567890.12' }).execute();
        const row = await tx.selectFrom('flowAmount').select(['effectiveFrom', 'amount']).where('flowId', '=', flowId).executeTakeFirstOrThrow();
        expect(row).toEqual({ effectiveFrom: '2026-06-01', amount: '1234567890.12' });
      }));
  });
});
