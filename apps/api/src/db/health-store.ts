import { sql } from 'kysely';
import type { Database } from './database';

/** The latest applied migration, or null if the database is unreachable. */
export async function databaseStatus(db: Database): Promise<{ reachable: boolean; migration: string | null }> {
  try {
    const r = await sql<{ name: string }>`SELECT name FROM kysely_migration ORDER BY name DESC LIMIT 1`.execute(db);
    return { reachable: true, migration: r.rows[0]?.name ?? null };
  } catch {
    return { reachable: false, migration: null };
  }
}
