import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './schema';

/**
 * The only construction of a Kysely instance in the API. Lint keeps `kysely`
 * and `pg` imports inside src/db/ (ADR-016).
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

export function createDatabase(connectionString: string, max = 5): Database {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max }) }),
    plugins: [new CamelCasePlugin()],
  });
}
