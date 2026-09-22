import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { createTestDatabase, hasDatabase } from '../testing/test-app';
import { createDatabase, type Database } from './database';
import { purgeTombstones } from './purge-store';
import { pull } from './sync-store';

/**
 * The tombstone purge (ADR-007) against a fresh database: what goes, what must
 * stay, and the watermark that makes stale phones re-pull.
 */
const suite = hasDatabase ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2027-06-01T00:00:00Z');
const cutoff = new Date(now.getTime() - 180 * DAY);
const old = new Date(now.getTime() - 200 * DAY).toISOString();
const recent = new Date(now.getTime() - 10 * DAY).toISOString();

suite('tombstone purge (integration)', () => {
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

  const exists = async (table: 'flow' | 'occurrence' | 'category' | 'member' | 'flowAmount', id: string) =>
    (await db.selectFrom(table).select('id').where('id', '=', id).executeTakeFirst()) !== undefined;

  async function flow(deletedAt: string | null): Promise<string> {
    const id = randomUUID();
    await db.insertInto('flow').values({ id, name: 'f', direction: 'OUT', recurrenceKind: 'ONE_OFF', startDate: '2026-01-01', deletedAt }).execute();
    return id;
  }
  async function occurrence(flowId: string, extra: { status?: string; settledOn?: string; settledAmount?: string; deletedAt?: string | null } = {}): Promise<string> {
    const id = randomUUID();
    await db.insertInto('occurrence').values({ id, flowId, ruleDate: '2026-01-01', dueDate: '2026-01-01', amount: '10.00', ...extra }).execute();
    return id;
  }

  it('removes old unreferenced tombstones, keeps what surviving rows still need, and raises the watermark', async () => {
    // A deleted flow whose settled history survives: the history and the flow stay; its old PLANNED tombstone goes.
    const withHistory = await flow(old);
    const settled = await occurrence(withHistory, { status: 'SETTLED', settledOn: '2026-01-01', settledAmount: '10.00' });
    // Unique rule date per flow: give the tombstoned one its own date.
    const tombstonedOcc = randomUUID();
    await db.insertInto('occurrence').values({ id: tombstonedOcc, flowId: withHistory, ruleDate: '2026-02-01', dueDate: '2026-02-01', amount: '10.00', deletedAt: old }).execute();

    // A deleted flow with nothing left: it and its amount go.
    const gone = await flow(old);
    const goneAmount = randomUUID();
    await db.insertInto('flowAmount').values({ id: goneAmount, flowId: gone, effectiveFrom: '2026-01-01', amount: '10.00', deletedAt: old }).execute();

    // Deleted recently: inside the window, stays.
    const young = await flow(recent);

    // A parent and child category, both old tombstones: both go in one run.
    const parent = randomUUID();
    const child = randomUUID();
    await db.insertInto('category').values({ id: parent, name: 'P', deletedAt: old }).execute();
    await db.insertInto('category').values({ id: child, name: 'C', parentId: parent, deletedAt: old }).execute();
    // An old tombstoned category a live flow still uses: stays.
    const inUse = randomUUID();
    await db.insertInto('category').values({ id: inUse, name: 'K', deletedAt: old }).execute();
    const live = randomUUID();
    await db.insertInto('flow').values({ id: live, name: 'live', direction: 'OUT', recurrenceKind: 'ONE_OFF', startDate: '2026-01-01', categoryId: inUse }).execute();

    // Members: one still named by a goal stays; one named by nothing goes.
    const named = randomUUID();
    const unnamed = randomUUID();
    await db.insertInto('member').values([{ id: named, name: 'X', deletedAt: old }, { id: unnamed, name: 'Y', deletedAt: old }]).execute();
    await db.insertInto('goal').values({ id: randomUUID(), name: 'g', memberId: named, targetAmount: '1.00', targetDate: '2027-01-01' }).execute();

    const { minRetainedVersion: before } = await db.selectFrom('syncState').select('minRetainedVersion').executeTakeFirstOrThrow();
    const result = await purgeTombstones(db, cutoff);

    expect(await exists('occurrence', settled)).toBe(true);
    expect(await exists('flow', withHistory)).toBe(true);
    expect(await exists('occurrence', tombstonedOcc)).toBe(false);
    expect(await exists('flow', gone)).toBe(false);
    expect(await exists('flowAmount', goneAmount)).toBe(false);
    expect(await exists('flow', young)).toBe(true);
    expect(await exists('category', parent)).toBe(false);
    expect(await exists('category', child)).toBe(false);
    expect(await exists('category', inUse)).toBe(true);
    expect(await exists('flow', live)).toBe(true);
    expect(await exists('member', named)).toBe(true);
    expect(await exists('member', unnamed)).toBe(false);
    expect(result.deleted).toMatchObject({ occurrence: 1, flow_amount: 1, flow: 1, category: 2, member: 1 });
    expect(BigInt(result.minRetainedVersion)).toBeGreaterThan(BigInt(before));
  });

  it('makes a phone that missed a purged tombstone re-pull, and leaves an up-to-date one alone', async () => {
    const { minRetainedVersion } = await db.selectFrom('syncState').select('minRetainedVersion').executeTakeFirstOrThrow();
    const watermark = BigInt(minRetainedVersion);
    expect(await pull(db, watermark - 1n)).toEqual({ resetRequired: true });
    expect((await pull(db, watermark)).resetRequired).toBe(false);
    expect((await pull(db, 0n)).resetRequired).toBe(false);
  });

  it('is idempotent and never lowers the watermark', async () => {
    const first = await purgeTombstones(db, cutoff);
    const second = await purgeTombstones(db, cutoff);
    expect(Object.values(second.deleted).every((n) => n === 0)).toBe(true);
    expect(second.minRetainedVersion).toBe(first.minRetainedVersion);
  });

  it('leaves hard delete refused outside the purge transaction', async () => {
    const id = await flow(old);
    await expect(sql`DELETE FROM flow WHERE id = ${id}`.execute(db)).rejects.toThrow(/hard DELETE on flow is not allowed/);
  });
});
