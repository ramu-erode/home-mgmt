import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import type { PullTable, PushResponse, SyncRow } from '@home-mgmt/shared';
import { ApiClient } from './api-client';
import { DATA_TABLES, LocalDb, type OutboxEntry } from './local-db';
import { liveSignal } from './live-signal';

export const LOCAL_DB = new InjectionToken<LocalDb>('LOCAL_DB', { providedIn: 'root', factory: () => new LocalDb() });

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'update-required' | 'error';

const PERIODIC_MS = 60_000;
const KICK_DEBOUNCE_MS = 300;

/**
 * How long to wait before retrying after `failures` consecutive failed rounds:
 * quick at first (a blip, a phone waking up), then slower, capped at five
 * minutes. Foregrounding the app or the network returning always retries at
 * once, whatever the backoff says.
 */
export function retryDelay(failures: number): number {
  const steps = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
  return steps[Math.min(Math.max(failures, 1), steps.length) - 1];
}

/**
 * Push the outbox, then pull deltas (ADR-009).
 *
 * - Push first, so a pull never brings back the server's old copy of a row the
 *   phone has just changed. Rows that still have a pending entry after the push
 *   are skipped by the pull; the next round delivers them.
 * - Any rejection resets the cursor and re-pulls everything: the phone applied
 *   the rejected change optimistically, and the server's copy of that row may
 *   be older than the cursor. At household scale a full pull is cheap.
 * - `resetRequired` (cursor older than the tombstone purge) clears the data
 *   tables — never the outbox — and pulls from zero.
 * - A 426 stops syncing until the app reloads onto the new bundle; the outbox is
 *   kept for the new code to push.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly db = inject(LOCAL_DB);
  private readonly api = inject(ApiClient);

  private readonly _status = signal<SyncStatus>('idle');
  private readonly _error = signal<string | null>(null);
  readonly status = this._status.asReadonly();
  readonly error = this._error.asReadonly();

  readonly pending = liveSignal(() => this.db.outbox.count(), 0);
  readonly rejections = liveSignal(() => this.db.rejection.toArray(), []);
  readonly lastSyncedAt = liveSignal(async () => (await this.db.meta.get('lastSyncedAt'))?.value ?? null, null as string | null);
  /** False until the first sync attempt finishes, successfully or not. */
  readonly settled = signal(false);
  readonly busy = computed(() => this._status() === 'syncing');

  private running: Promise<void> | null = null;
  private again = false;
  private kickTimer: ReturnType<typeof setTimeout> | null = null;
  private nextTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;

  /**
   * Starts syncing: now; whenever the app comes to the foreground or the
   * network returns; then every minute while it works, backing off while the
   * Mac is unreachable. An installed iOS web app gets no background sync, so
   * foregrounding is the trigger that matters.
   */
  start(): void {
    void this.run();
    globalThis.addEventListener?.('online', () => void this.run());
    globalThis.document?.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.run();
    });
  }

  /** Cancels scheduled rounds (tests, teardown). */
  stop(): void {
    for (const t of [this.kickTimer, this.nextTimer]) if (t) clearTimeout(t);
    this.kickTimer = this.nextTimer = null;
  }

  /** Called after every local write; coalesces bursts of edits into one round. */
  kick(): void {
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickTimer = setTimeout(() => void this.run(), KICK_DEBOUNCE_MS);
  }

  /** One sync round; concurrent calls fold into a single follow-up round. */
  run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
      this.settled.set(true);
    });
    return this.running;
  }

  async deviceId(): Promise<string> {
    const existing = await this.db.meta.get('deviceId');
    if (existing) return existing.value;
    const id = crypto.randomUUID();
    await this.db.meta.put({ key: 'deviceId', value: id });
    return id;
  }

  private async loop(): Promise<void> {
    do {
      this.again = false;
      if (this._status() === 'update-required') return;
      this._status.set('syncing');
      const next = await this.round();
      this._status.set(next);
    } while (this.again);
    this.scheduleNext();
  }

  /** The next unprompted round: a minute after success, backing off after failure, never after a 426. */
  private scheduleNext(): void {
    if (this.nextTimer) clearTimeout(this.nextTimer);
    const status = this._status();
    if (status === 'update-required') return;
    this.failures = status === 'idle' ? 0 : this.failures + 1;
    this.nextTimer = setTimeout(() => void this.run(), this.failures ? retryDelay(this.failures) : PERIODIC_MS);
  }

  private async round(): Promise<SyncStatus> {
    const deviceId = await this.deviceId();
    const pushed = await this.pushOutbox(deviceId);
    if (pushed !== 'ok' && pushed !== 'rejections') return pushed;
    return this.pullChanges(deviceId, pushed === 'rejections');
  }

  private async pushOutbox(deviceId: string): Promise<'ok' | 'rejections' | SyncStatus> {
    const entries = await this.db.outbox.orderBy('seq').toArray();
    if (entries.length === 0) return 'ok';
    const result = await this.api.push(entries.map((e) => e.operation), deviceId);
    if (result.kind !== 'ok') return this.failed(result);
    await this.settleOutbox(entries, result.body);
    return result.body.rejected.length > 0 ? 'rejections' : 'ok';
  }

  /** Removes every entry the server answered for; records rejections for the UI. */
  private async settleOutbox(entries: OutboxEntry[], response: PushResponse): Promise<void> {
    const answered = new Set([...response.applied, ...response.rejected.map((r) => r.id)]);
    const at = new Date().toISOString();
    await this.db.transaction('rw', this.db.outbox, this.db.rejection, async () => {
      await this.db.outbox.bulkDelete(entries.filter((e) => answered.has(e.operation.id)).map((e) => e.seq as number));
      for (const r of response.rejected) {
        const entry = entries.find((e) => e.operation.id === r.id);
        await this.db.rejection.put({ id: r.id, table: entry?.operation.table ?? '?', rowId: entry?.rowId ?? '', reason: r.reason, message: r.message, at });
      }
    });
  }

  private async pullChanges(deviceId: string, fromScratch: boolean): Promise<SyncStatus> {
    const since = fromScratch ? '0' : ((await this.db.meta.get('cursor'))?.value ?? '0');
    const result = await this.api.pull(since, deviceId);
    if (result.kind !== 'ok') return this.failed(result);
    if (result.body.resetRequired) {
      await this.clearData();
      return this.pullChanges(deviceId, true);
    }
    await this.applyPull(result.body.changes, result.body.cursor, fromScratch);
    this._error.set(null);
    return 'idle';
  }

  private async applyPull(changes: Partial<Record<PullTable, SyncRow[]>>, cursor: string, replace: boolean): Promise<void> {
    const tables = DATA_TABLES.map((t) => this.db.rows(t));
    await this.db.transaction('rw', [...tables, this.db.outbox, this.db.meta], async () => {
      const pendingRows = new Set((await this.db.outbox.toArray()).map((e) => e.rowId));
      if (replace) await this.clearUnpending(pendingRows);
      for (const table of DATA_TABLES) {
        const rows = (changes[table] ?? []).filter((r) => !pendingRows.has(r.id));
        if (rows.length) await this.db.rows(table).bulkPut(rows as never[]);
      }
      await this.db.meta.bulkPut([
        { key: 'cursor', value: cursor },
        { key: 'lastSyncedAt', value: new Date().toISOString() },
      ]);
    });
  }

  /** A full re-pull replaces every row the phone is not still waiting to push. */
  private async clearUnpending(pendingRows: Set<string>): Promise<void> {
    for (const table of DATA_TABLES) {
      const rows = this.db.rows(table);
      const keys = (await rows.toCollection().primaryKeys()).filter((k) => !pendingRows.has(k));
      await rows.bulkDelete(keys);
    }
  }

  private async clearData(): Promise<void> {
    await this.db.transaction('rw', [...DATA_TABLES.map((t) => this.db.rows(t)), this.db.meta], async () => {
      for (const t of DATA_TABLES) await this.db.rows(t).clear();
      await this.db.meta.delete('cursor');
    });
  }

  private failed(result: { kind: 'offline' | 'update-required' } | { kind: 'error'; status: number; message: string }): SyncStatus {
    if (result.kind === 'error') this._error.set(`Server error ${result.status}: ${result.message}`);
    return result.kind;
  }

  async dismissRejection(id: string): Promise<void> {
    await this.db.rejection.delete(id);
  }
}
