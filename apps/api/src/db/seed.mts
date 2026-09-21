/**
 * Loads the SYNTHETIC household into the dev database. Idempotent: rows are
 * keyed by the fixture's fixed ids, so re-running changes nothing.
 *
 *   node apps/api/src/db/seed.mts
 *
 * The fixture is shared with the engine's golden test, so the seeded data and
 * the tested forecast cannot drift apart. Real household data never goes in a
 * file in git; enter it through the app, or keep a private `*.local.*` seed.
 *
 * Occurrences are not seeded: only the server's regeneration creates them
 * (ADR-009), and seeding them here would bypass the path under test.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../libs/core/src/testing/synthetic-household.json');

interface Household {
  members: { id: string; name: string; displayOrder: number }[];
  categories: { id: string; name: string; parentId: string | null }[];
  flows: (Record<string, unknown> & {
    id: string;
    amounts: { effectiveFrom: string; amount: string }[];
    allocations: { memberId: string; weight: number }[];
  })[];
  goals: Record<string, unknown>[];
  snapshot: Record<string, unknown>;
}

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const h = JSON.parse(await readFile(FIXTURE, 'utf8')) as Household;

  // Untyped on purpose: this script runs under plain Node type stripping and
  // cannot import the generated schema without a build step.
  const db = new Kysely<any>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 1 }) }),
    plugins: [new CamelCasePlugin()],
  });
  try {
    await db.transaction().execute(async (tx) => {
      await insert(tx, 'member', h.members);
      // Parents before children, for the self-reference.
      await insert(tx, 'category', h.categories.filter((c) => c.parentId === null));
      await insert(tx, 'category', h.categories.filter((c) => c.parentId !== null));
      await insert(tx, 'flow', h.flows.map(({ amounts: _a, allocations: _b, ...flow }) => flow));
      for (const f of h.flows) {
        await insertKeyed(tx, 'flow_amount', ['flowId', 'effectiveFrom'], f.amounts.map((a) => ({ flowId: f.id, ...a })));
        await insertKeyed(tx, 'flow_allocation', ['flowId', 'memberId'], f.allocations.map((a) => ({ flowId: f.id, ...a })));
      }
      await insert(tx, 'goal', h.goals);
      await insert(tx, 'balance_snapshot', [h.snapshot]);
    });
    console.log(`seeded: ${h.members.length} members, ${h.categories.length} categories, ${h.flows.length} flows, ${h.goals.length} goals, 1 snapshot`);
  } finally {
    await db.destroy();
  }
}

async function insert(tx: Kysely<any>, table: string, rows: object[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insertInto(table).values(rows).onConflict((oc) => oc.column('id').doNothing()).execute();
}

/** For child rows without fixed ids: conflict on the partial natural-key index. */
async function insertKeyed(tx: Kysely<any>, table: string, key: string[], rows: object[]): Promise<void> {
  if (rows.length === 0) return;
  await tx
    .insertInto(table)
    .values(rows)
    .onConflict((oc) => oc.columns(key).where('deletedAt', 'is', null).doNothing())
    .execute();
}

main().catch((err: unknown) => {
  console.error('seed failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
