import { TestBed } from '@angular/core/testing';
import type { Operation, PullResponse, PushResponse, SyncRow } from '@home-mgmt/shared';
import { ApiClient, type ApiResult } from './api-client';
import { LocalDb } from './local-db';
import { LocalStore } from './local-store';
import { LOCAL_DB, retryDelay, SyncService } from './sync.service';

/**
 * The phone's half of ADR-009, against a real Dexie on fake-indexeddb and a
 * scripted server.
 */
class FakeApi {
  pushes: Operation[][] = [];
  pulls: string[] = [];
  pushReply: (ops: Operation[]) => ApiResult<PushResponse> = (ops) => ({ kind: 'ok', body: { applied: ops.map((o) => o.id), rejected: [] } });
  pullReply: (since: string) => ApiResult<PullResponse> = () => ({ kind: 'ok', body: { resetRequired: false, cursor: '10', changes: {} } });

  async push(ops: Operation[]) {
    this.pushes.push(ops);
    return this.pushReply(ops);
  }
  async pull(since: string) {
    this.pulls.push(since);
    return this.pullReply(since);
  }
}

const member = (id: string, name: string, version = '5'): SyncRow => ({ id, name, displayOrder: 1, version, deletedAt: null });

describe('local-first data layer', () => {
  let db: LocalDb;
  let api: FakeApi;
  let store: LocalStore;
  let sync: SyncService;

  beforeEach(() => {
    db = new LocalDb(`test-${crypto.randomUUID()}`);
    api = new FakeApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: LOCAL_DB, useValue: db },
        { provide: ApiClient, useValue: api },
      ],
    });
    store = TestBed.inject(LocalStore);
    sync = TestBed.inject(SyncService);
  });

  afterEach(async () => {
    sync.stop();
    db.close();
    await db.delete();
  });

  describe('writes', () => {
    it('land in IndexedDB and the outbox together, with exactly the columns the server validates', async () => {
      await store.save('member', { id: 'm1', name: 'Child 1', displayOrder: 3 });
      expect(await db.member.get('m1')).toMatchObject({ name: 'Child 1', version: '0', deletedAt: null });
      const [entry] = await db.outbox.toArray();
      expect(entry.rowId).toBe('m1');
      expect(entry.operation).toMatchObject({ table: 'member', op: 'upsert', payload: { id: 'm1', name: 'Child 1', displayOrder: 3 } });
      expect(Object.keys((entry.operation as { payload: object }).payload).sort()).toEqual(['displayOrder', 'id', 'name']);
    });

    it('queues a flow before its amounts, in one transaction', async () => {
      await store.saveAll([
        { table: 'flow', draft: { id: 'f1', name: 'Swim', categoryId: null, direction: 'OUT', recurrenceKind: 'ONE_OFF', freq: null, interval: null, months: null, dayOfMonth: null, startDate: '2027-01-01' as never, endDate: null } },
        { table: 'flowAmount', draft: { id: 'a1', flowId: 'f1', effectiveFrom: '2027-01-01' as never, amount: '100.00' as never } },
      ]);
      expect((await db.outbox.orderBy('seq').toArray()).map((e) => e.operation.table)).toEqual(['flow', 'flowAmount']);
    });

    it('an occurrence command applies locally with the server rules, and a refused one queues nothing', async () => {
      await db.occurrence.put({ id: 'o1', flowId: 'f1', ruleDate: '2026-10-05' as never, dueDate: '2026-10-05' as never, amount: '100.00' as never, status: 'SETTLED', isAmountOverridden: false, isDateOverridden: false, settledOn: '2026-10-05' as never, settledAmount: '100.00' as never, note: null, version: '3', deletedAt: null });
      expect(await store.command('o1', { command: 'skip' })).toBe('Already settled.');
      expect(await db.outbox.count()).toBe(0);

      expect(await store.command('o1', { command: 'note', args: { text: 'cheque' } })).toBeNull();
      expect((await db.occurrence.get('o1'))?.note).toBe('cheque');
      expect((await db.outbox.toArray())[0].operation).toMatchObject({ table: 'occurrence', op: 'command', occurrenceId: 'o1', command: 'note' });
    });
  });

  describe('sync', () => {
    it('pushes the outbox, empties it, then pulls from the saved cursor', async () => {
      await store.save('member', { id: 'm1', name: 'A', displayOrder: 1 });
      await sync.run();
      expect(api.pushes).toHaveLength(1);
      expect(await db.outbox.count()).toBe(0);
      expect(api.pulls).toEqual(['0']);
      await sync.run();
      expect(api.pulls).toEqual(['0', '10']);
      expect(sync.status()).toBe('idle');
    });

    it('never lets a pull overwrite a row with a change still pending', async () => {
      api.pushReply = () => ({ kind: 'offline' });
      await store.save('member', { id: 'm1', name: 'Mine, unsynced', displayOrder: 1 });
      await sync.run();
      expect(sync.status()).toBe('offline');

      // The Mac comes back but this push fails mid-way; the pull must still skip m1.
      api.pushReply = (ops) => ({ kind: 'ok', body: { applied: [], rejected: [] } }) as never;
      api.pullReply = () => ({ kind: 'ok', body: { resetRequired: false, cursor: '20', changes: { member: [member('m1', 'Server copy'), member('m2', 'Other')] } } });
      await sync.run();
      expect((await db.member.get('m1'))?.name).toBe('Mine, unsynced');
      expect((await db.member.get('m2'))?.name).toBe('Other');
    });

    it('records a rejection for the UI and re-pulls everything, so the rejected local edit is replaced', async () => {
      await db.member.put(member('m1', 'Server name') as never);
      await db.meta.put({ key: 'cursor', value: '50' });
      await store.save('member', { id: 'm1', name: 'Rejected edit', displayOrder: 1 });

      api.pushReply = (ops) => ({ kind: 'ok', body: { applied: [], rejected: [{ id: ops[0].id, reason: 'stale', message: 'A newer change to this row already won.' }] } });
      api.pullReply = (since) => ({ kind: 'ok', body: { resetRequired: false, cursor: '60', changes: since === '0' ? { member: [member('m1', 'Server name')] } : {} } });
      await sync.run();

      expect(api.pulls).toEqual(['0']);
      expect((await db.member.get('m1'))?.name).toBe('Server name');
      expect(await db.rejection.toArray()).toMatchObject([{ table: 'member', rowId: 'm1', reason: 'stale' }]);
      expect(await db.outbox.count()).toBe(0);
    });

    it('on resetRequired clears the data — never the outbox — and pulls from zero', async () => {
      await db.member.put(member('stale', 'Purged elsewhere') as never);
      await db.meta.put({ key: 'cursor', value: '5' });
      api.pullReply = (since) => (since === '5' ? { kind: 'ok', body: { resetRequired: true } } : { kind: 'ok', body: { resetRequired: false, cursor: '99', changes: { member: [member('m9', 'Fresh')] } } });
      await sync.run();
      expect(await db.member.get('stale')).toBeUndefined();
      expect((await db.member.get('m9'))?.name).toBe('Fresh');
      expect((await db.meta.get('cursor'))?.value).toBe('99');
    });

    it('on 426 stops and keeps the outbox for the updated app to push', async () => {
      api.pushReply = () => ({ kind: 'update-required' });
      await store.save('member', { id: 'm1', name: 'A', displayOrder: 1 });
      await sync.run();
      expect(sync.status()).toBe('update-required');
      expect(await db.outbox.count()).toBe(1);
      await sync.run();
      expect(api.pushes).toHaveLength(1); // no retry until reload
    });

    it('backs off quickly, then slowly, capped at five minutes', () => {
      expect([1, 2, 3, 4, 5, 6, 7, 50].map(retryDelay)).toEqual([5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 300_000, 300_000]);
    });

    it('keeps a stable device id across calls', async () => {
      expect(await sync.deviceId()).toBe(await sync.deviceId());
    });
  });
});
