/**
 * Applies the SQL migrations in ./migrations, in filename order, each in its
 * own transaction. Run with Node's built-in type stripping — no build step, so
 * the same file runs in the devcontainer and on the Mac during a deploy
 * (ADR-017):
 *
 *   node apps/api/src/db/migrate.mts            # apply everything pending
 *   node apps/api/src/db/migrate.mts --status   # list applied / pending
 *
 * Migrations are expand-then-contract (ADR-009): never add a column and drop
 * the one it replaces in the same release. There is no "down" — rolling back a
 * schema is a restore of the pre-deploy dump, never automatic.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import pg from 'pg';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

class SqlFileProvider implements MigrationProvider {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async getMigrations(): Promise<Record<string, Migration>> {
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.sql')).sort();
    const entries = await Promise.all(
      files.map(async (file) => {
        const text = await readFile(path.join(this.dir, file), 'utf8');
        const migration: Migration = { up: async (db) => void (await sql.raw(text).execute(db)) };
        return [file.replace(/\.sql$/, ''), migration] as const;
      }),
    );
    return Object.fromEntries(entries);
  }
}

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 1 }) }) });
  const migrator = new Migrator({ db, provider: new SqlFileProvider(MIGRATIONS) });
  try {
    if (process.argv.includes('--status')) await status(migrator);
    else await migrate(migrator);
  } finally {
    await db.destroy();
  }
}

async function migrate(migrator: Migrator): Promise<void> {
  const { error, results = [] } = await migrator.migrateToLatest();
  for (const r of results) console.log(`${r.status === 'Success' ? 'applied' : r.status.toLowerCase()}  ${r.migrationName}`);
  if (results.length === 0 && !error) console.log('up to date');
  if (error) throw error;
}

async function status(migrator: Migrator): Promise<void> {
  for (const m of await migrator.getMigrations()) {
    console.log(`${m.executedAt ? 'applied' : 'pending'}  ${m.name}`);
  }
}

main().catch((err: unknown) => {
  console.error('migration failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
