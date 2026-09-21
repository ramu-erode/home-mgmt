import { randomUUID } from 'node:crypto';
import { DATABASE, type Database } from '../db/database';
import { setMinRetainedVersion } from '../testing/db-helpers';
import { createTestDatabase, hasDatabase, startApp, type TestApp } from '../testing/test-app';

/**
 * The sync protocol end to end over HTTP (ADR-009), against a fresh database.
 * Today is fixed at 2026-09-21, so the horizon is 2026-09-01 … 2028-02-29.
 */
const suite = hasDatabase ? describe : describe.skip;

// Timestamps safely in the past, so the server's clock clamp never applies.
const at = (n: number) => `2025-01-01T00:00:${String(n).padStart(2, '0')}.000Z`;
let tick = 0;
const next = () => at(++tick);

const upsert = (table: string, payload: Record<string, unknown>, clientUpdatedAt = next()) => ({ id: randomUUID(), table, op: 'upsert', payload, clientUpdatedAt });
const remove = (table: string, id: string, clientUpdatedAt = next()) => ({ id: randomUUID(), table, op: 'delete', payload: { id }, clientUpdatedAt });
const command = (occurrenceId: string, cmd: Record<string, unknown>) => ({ id: randomUUID(), table: 'occurrence', op: 'command', occurrenceId, clientUpdatedAt: next(), ...cmd });

function swimming(id = randomUUID()) {
  return {
    flow: { id, name: 'Swimming', categoryId: null, direction: 'OUT', recurrenceKind: 'INTERVAL', freq: 'MONTHLY', interval: 1, months: null, dayOfMonth: 5, startDate: '2026-01-05', endDate: null },
    amount: { id: randomUUID(), flowId: id, effectiveFrom: '2026-01-01', amount: '2500.00' },
  };
}

suite('sync (integration)', () => {
  let t: TestApp;
  let db: Database;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const test = await createTestDatabase();
    drop = test.drop;
    t = await startApp(test.url);
    db = t.app.get(DATABASE);
  });
  afterAll(async () => {
    await t?.close();
    await drop?.();
  });

  const push = async (...operations: unknown[]) => {
    const r = await t.call('/sync', { method: 'POST', body: { operations } });
    expect(r.status).toBe(200);
    return r.body as { applied: string[]; rejected: { id: string; reason: string; message: string }[] };
  };
  const occurrencesOf = (flowId: string) =>
    db.selectFrom('occurrence').selectAll().where('flowId', '=', flowId).where('deletedAt', 'is', null).orderBy('ruleDate').execute();
  const occurrenceOn = async (flowId: string, ruleDate: string) => {
    const row = (await occurrencesOf(flowId)).find((o) => o.ruleDate === ruleDate);
    if (!row) throw new Error(`no occurrence of ${flowId} on ${ruleDate}`);
    return row;
  };

  describe('the perimeter', () => {
    it('refuses a request without the household tailnet identity', async () => {
      expect((await t.call('/sync', { headers: { 'tailscale-user-login': '' } })).status).toBe(403);
      expect((await t.call('/sync', { headers: { 'tailscale-user-login': 'someone@else.com' } })).status).toBe(403);
    });

    it('leaves health public, for the deploy script on loopback', async () => {
      const r = await t.call('/health', { headers: { 'tailscale-user-login': '' } });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ sha: 'test-sha', migration: '0001_initial', database: 'ok', backupStale: true });
    });

    it('answers an unsupported protocol with 426, so the client updates before pushing', async () => {
      expect((await t.call('/sync', { headers: { 'x-protocol-version': '0' } })).status).toBe(426);
      expect((await t.call('/sync', { headers: { 'x-protocol-version': '' } })).status).toBe(426);
    });

    it('requires the device id on a push', async () => {
      expect((await t.call('/sync', { method: 'POST', body: { operations: [] }, headers: { 'x-device-id': 'nope' } })).status).toBe(400);
    });
  });

  describe('materialisation (ADR-009)', () => {
    it('a pushed flow and its amount become 18 PLANNED occurrences in the same push', async () => {
      const { flow, amount } = swimming();
      const r = await push(upsert('flow', flow), upsert('flowAmount', amount));
      expect(r.rejected).toEqual([]);
      const rows = await occurrencesOf(flow.id);
      expect(rows).toHaveLength(18);
      expect(rows[0]).toMatchObject({ ruleDate: '2026-09-05', dueDate: '2026-09-05', amount: '2500.00', status: 'PLANNED' });
      expect(rows[17].ruleDate).toBe('2028-02-05');
    });

    it('a flow with no amount yet is accepted and materialises nothing until the amount arrives', async () => {
      const { flow, amount } = swimming();
      expect((await push(upsert('flow', flow))).rejected).toEqual([]);
      expect(await occurrencesOf(flow.id)).toHaveLength(0);
      await push(upsert('flowAmount', amount));
      expect(await occurrencesOf(flow.id)).toHaveLength(18);
    });

    it('registers an unknown device rather than failing its first push', async () => {
      const device = await db.selectFrom('device').selectAll().where('id', '=', '0d0d0d0d-0000-4000-8000-000000000001').executeTakeFirst();
      expect(device?.name).toBe('New device');
    });
  });

  describe('the ADR-003 invariant, through the API', () => {
    it('a fee hike moves PLANNED occurrences; a CONFIRMED one keeps what was confirmed', async () => {
      const { flow, amount } = swimming();
      await push(upsert('flow', flow), upsert('flowAmount', amount));
      const feb = await occurrenceOn(flow.id, '2027-02-05');
      expect((await push(command(feb.id, { command: 'confirm' }))).rejected).toEqual([]);

      await push(upsert('flowAmount', { id: randomUUID(), flowId: flow.id, effectiveFrom: '2027-02-01', amount: '2750.00' }));
      const rows = await occurrencesOf(flow.id);
      expect(rows.find((o) => o.ruleDate === '2027-01-05')?.amount).toBe('2500.00');
      expect(rows.find((o) => o.ruleDate === '2027-02-05')).toMatchObject({ amount: '2500.00', status: 'CONFIRMED' });
      expect(rows.find((o) => o.ruleDate === '2027-03-05')?.amount).toBe('2750.00');
    });

    it('a date override is not re-inserted by the next regeneration', async () => {
      const { flow, amount } = swimming();
      await push(upsert('flow', flow), upsert('flowAmount', amount));
      const oct = await occurrenceOn(flow.id, '2026-10-05');
      await push(command(oct.id, { command: 'override', args: { dueDate: '2026-10-09' } }));

      await push(upsert('flow', { ...flow, name: 'Swimming (renamed)' })); // touches → regenerates
      const october = (await occurrencesOf(flow.id)).filter((o) => o.ruleDate.startsWith('2026-10'));
      expect(october).toHaveLength(1);
      expect(october[0]).toMatchObject({ dueDate: '2026-10-09', isDateOverridden: true });
    });

    it('deleting a flow tombstones its PLANNED occurrences and its schedule; confirmed history stays', async () => {
      const { flow, amount } = swimming();
      await push(upsert('flow', flow), upsert('flowAmount', amount));
      const [sep, oct] = await occurrencesOf(flow.id);
      await push(command(sep.id, { command: 'settle', args: { on: '2026-09-05', amount: '2500.00' } }));

      expect((await push(remove('flow', flow.id))).rejected).toEqual([]);
      const live = await occurrencesOf(flow.id);
      expect(live.map((o) => [o.ruleDate, o.status])).toEqual([['2026-09-05', 'SETTLED']]);
      const amounts = await db.selectFrom('flowAmount').select('deletedAt').where('flowId', '=', flow.id).execute();
      expect(amounts.every((a) => a.deletedAt !== null)).toBe(true);

      const r = await push(command(oct.id, { command: 'confirm' }));
      expect(r.rejected).toMatchObject([{ reason: 'gone' }]);
    });
  });

  describe('last-write-wins on client time', () => {
    it('an older edit arriving later is rejected as stale, and the newer value stands', async () => {
      const id = randomUUID();
      await push(upsert('member', { id, name: 'Newer', displayOrder: 1 }, at(50)));
      const r = await push(upsert('member', { id, name: 'Older', displayOrder: 1 }, at(40)));
      expect(r.rejected).toMatchObject([{ reason: 'stale' }]);
      expect((await db.selectFrom('member').select('name').where('id', '=', id).executeTakeFirst())?.name).toBe('Newer');
    });

    it('an edit made after a delete brings the row back; one made before does not', async () => {
      const id = randomUUID();
      await push(upsert('member', { id, name: 'A', displayOrder: 1 }, at(10)), remove('member', id, at(20)));
      expect((await push(upsert('member', { id, name: 'Before', displayOrder: 1 }, at(15)))).rejected).toMatchObject([{ reason: 'stale' }]);
      await push(upsert('member', { id, name: 'After', displayOrder: 1 }, at(30)));
      expect(await db.selectFrom('member').select(['name', 'deletedAt']).where('id', '=', id).executeTakeFirst()).toEqual({ name: 'After', deletedAt: null });
    });
  });

  describe('rejections are per operation, with reasons', () => {
    it('one bad operation does not sink the rest of the push', async () => {
      const good = randomUUID();
      const bad = upsert('flow', { ...swimming().flow, months: [6] }); // INTERVAL may not carry months
      const r = await push(bad, upsert('member', { id: good, name: 'Fine', displayOrder: 0 }), { id: 'not-a-uuid' });
      expect(r.applied).toHaveLength(1);
      expect(r.rejected.map((x) => x.reason)).toEqual(['invalid', 'invalid']);
      expect(await db.selectFrom('member').select('id').where('id', '=', good).executeTakeFirst()).toBeDefined();
    });

    it('a flow cannot change direction', async () => {
      const { flow } = swimming();
      await push(upsert('flow', flow));
      expect((await push(upsert('flow', { ...flow, direction: 'IN' }))).rejected).toMatchObject([{ reason: 'invalid', message: expect.stringMatching(/direction/) }]);
    });

    it('categories are two levels deep', async () => {
      const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
      const r = await push(
        upsert('category', { id: a, name: 'Top', parentId: null }),
        upsert('category', { id: b, name: 'Child', parentId: a }),
        upsert('category', { id: c, name: 'Grandchild', parentId: b }),
      );
      expect(r.applied).toHaveLength(2);
      expect(r.rejected).toMatchObject([{ reason: 'invalid', message: expect.stringMatching(/two levels/) }]);
    });

    it('phones cannot write occurrence rows directly', async () => {
      const r = await push({ id: randomUUID(), table: 'occurrence', op: 'upsert', payload: { id: randomUUID() }, clientUpdatedAt: next() });
      expect(r.rejected).toMatchObject([{ reason: 'invalid' }]);
    });
  });

  describe('pull', () => {
    it('returns everything from 0, then only what changed since the cursor — tombstones included', async () => {
      const first = await t.call('/sync?since=0');
      expect(first.body.resetRequired).toBe(false);
      const cursor = first.body.cursor as string;
      expect((await t.call(`/sync?since=${cursor}`)).body.changes).toEqual({});

      const id = randomUUID();
      await push(upsert('member', { id, name: 'Late', displayOrder: 9 }), remove('member', id));
      const delta = await t.call(`/sync?since=${cursor}`);
      expect(delta.body.changes.member).toHaveLength(1);
      expect(delta.body.changes.member[0]).toMatchObject({ id, name: 'Late', deletedAt: expect.any(String) });
      expect(BigInt(delta.body.cursor)).toBeGreaterThan(BigInt(cursor));
    });

    it('asks for a reset when the cursor predates the tombstone purge', async () => {
      await setMinRetainedVersion(db, 1000000);
      try {
        expect((await t.call('/sync?since=5')).body).toEqual({ resetRequired: true });
        expect((await t.call('/sync?since=0')).body.resetRequired).toBe(false);
      } finally {
        await setMinRetainedVersion(db, 0);
      }
    });

    it('rejects a malformed cursor', async () => {
      expect((await t.call('/sync?since=abc')).status).toBe(400);
    });
  });
});
