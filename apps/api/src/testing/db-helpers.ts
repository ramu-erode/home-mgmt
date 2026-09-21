import { sql } from 'kysely';
import type { Database } from '../db/database';

/** Test-only: pretend the tombstone purge has run up to `version`. */
export async function setMinRetainedVersion(db: Database, version: number): Promise<void> {
  await sql`UPDATE sync_state SET min_retained_version = ${version}`.execute(db);
}
