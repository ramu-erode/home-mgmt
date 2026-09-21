import { inject, Injectable } from '@angular/core';
import { PROTOCOL_VERSION, SYNC_COLUMNS, type OccurrenceCommand, type Operation, type SyncTable, type Uuid } from '@home-mgmt/shared';
import { applyCommand, REJECTION_MESSAGES } from '@home-mgmt/core';
import { LOCAL_DB, SyncService } from './sync.service';
import type { Draft, RowsByTable, SyncMeta } from './rows';

/** One row to write, typed by its table. */
export type Write = { [T in SyncTable]: { table: T; draft: Draft<T> } }[SyncTable];
export interface Delete {
  table: SyncTable;
  id: Uuid;
}

/**
 * The UI's only way to change data (ADR-006). Every write lands in IndexedDB
 * and in the outbox in one Dexie transaction, so a crash can never leave one
 * without the other; the sync service then pushes the outbox.
 */
@Injectable({ providedIn: 'root' })
export class LocalStore {
  private readonly db = inject(LOCAL_DB);
  private readonly sync = inject(SyncService);

  /** Writes whole rows (ADR-009: whole-row upserts, last-write-wins on client time). */
  async save<T extends SyncTable>(table: T, ...drafts: Draft<T>[]): Promise<void> {
    await this.saveAll(drafts.map((draft) => ({ table, draft }) as Write));
  }

  /** Several tables in one transaction and in outbox order — e.g. a flow before its amounts. */
  async saveAll(writes: Write[], deletes: Delete[] = []): Promise<void> {
    if (writes.length === 0 && deletes.length === 0) return;
    const tables = [...new Set([...writes.map((w) => w.table), ...deletes.map((d) => d.table)])].map((t) => this.db.rows(t));
    await this.db.transaction('rw', [...tables, this.db.outbox], async () => {
      for (const { table, draft } of writes) await this.writeRow(table, draft);
      for (const { table, id } of deletes) await this.deleteRow(table, id);
    });
    this.sync.kick();
  }

  async remove(table: SyncTable, id: Uuid): Promise<void> {
    await this.saveAll([], [{ table, id }]);
  }

  /**
   * Applies an occurrence command locally with the same rules the server uses,
   * so the phone shows the outcome immediately and refuses what the server
   * would refuse. Returns the refusal message, or null.
   */
  async command(occurrenceId: Uuid, cmd: OccurrenceCommand): Promise<string | null> {
    let refusal: string | null = null;
    await this.db.transaction('rw', this.db.occurrence, this.db.outbox, async () => {
      const row = await this.db.occurrence.get(occurrenceId);
      const result = applyCommand({ ...(row ?? ({} as RowsByTable['occurrence'])), deleted: !row || row.deletedAt !== null }, cmd);
      if (!result.ok) {
        refusal = REJECTION_MESSAGES[result.reason];
        return;
      }
      const { deleted: _deleted, ...patch } = result.patch;
      await this.db.occurrence.update(occurrenceId, patch);
      await this.enqueue(occurrenceId, { id: crypto.randomUUID(), table: 'occurrence', op: 'command', occurrenceId, clientUpdatedAt: now(), ...cmd } as Operation);
    });
    if (!refusal) this.sync.kick();
    return refusal;
  }

  private async writeRow(table: SyncTable, draft: Write['draft']): Promise<void> {
    const rows = this.db.rows(table);
    const existing = (await rows.get(draft.id)) as SyncMeta | undefined;
    await rows.put({ ...draft, version: existing?.version ?? '0', deletedAt: null } as never);
    // Exactly the columns the server validates (SYNC_COLUMNS) — never local metadata.
    const payload = Object.fromEntries([['id', draft.id], ...SYNC_COLUMNS[table].map((c) => [c, (draft as Record<string, unknown>)[c] ?? null])]);
    await this.enqueue(draft.id, { id: crypto.randomUUID(), table, op: 'upsert', payload: payload as { id: Uuid }, clientUpdatedAt: now() });
  }

  private async deleteRow(table: SyncTable, id: Uuid): Promise<void> {
    await this.db.rows(table).update(id, { deletedAt: now() } as never);
    await this.enqueue(id, { id: crypto.randomUUID(), table, op: 'delete', payload: { id }, clientUpdatedAt: now() });
  }

  private async enqueue(rowId: Uuid, operation: Operation): Promise<void> {
    await this.db.outbox.add({ rowId, protocolVersion: PROTOCOL_VERSION, operation });
  }
}

const now = () => new Date().toISOString();
