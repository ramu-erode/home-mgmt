import { CamelCasePlugin, Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { DB } from './schema';

/**
 * The only construction of a Kysely instance in the API. Lint keeps `kysely`
 * and `pg` imports inside src/db/ (ADR-016); code outside passes `Database`
 * and `Tx` around without ever touching the query builder.
 *
 * Type parsers, set once per process:
 * - `date` (OID 1082) stays a 'YYYY-MM-DD' string. The pg default parses it to
 *   local midnight of this process as a JS Date, which then serialises as the
 *   previous day in UTC for IST (ADR-013).
 * - `numeric` (1700) and `int8` (20) are strings by default — kept that way:
 *   money never becomes a float (ADR-012), and `version` may exceed 2^53.
 */
pg.types.setTypeParser(1082, (value: string) => value);

export type Database = Kysely<DB>;
export type Tx = Transaction<DB>;

export const DATABASE = Symbol('DATABASE');

export function createDatabase(connectionString: string, max = 5): Database {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max }) }),
    plugins: [new CamelCasePlugin()],
  });
}

export function inTransaction<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(fn);
}

/**
 * Runs `fn` under a savepoint. On error the savepoint is rolled back — the
 * transaction survives — and the error is rethrown for the caller to report.
 * One bad operation in a push must not abort the others (ADR-009).
 */
export async function withSavepoint<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await sql`SAVEPOINT op`.execute(tx);
  try {
    const result = await fn();
    await sql`RELEASE SAVEPOINT op`.execute(tx);
    return result;
  } catch (e) {
    await sql`ROLLBACK TO SAVEPOINT op`.execute(tx);
    throw e;
  }
}
