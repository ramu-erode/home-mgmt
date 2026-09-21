import Dexie, { type Table } from 'dexie';
import type { Operation, PullTable, RejectionReason, Uuid } from '@home-mgmt/shared';
import type { RowsByTable } from './rows';

/**
 * The phone's copy of the household (ADR-006): the read model every screen
 * uses, plus the outbox of changes not yet accepted by the Mac.
 *
 * Bump the version and add an upgrade function whenever a store changes —
 * queued outbox entries included (ADR-009: outbox entries carry the protocol
 * version that created them, and must be upgraded, never dropped).
 */
export interface OutboxEntry {
  seq?: number;
  /** The row the operation writes — pulls never overwrite a row with a pending change. */
  rowId: Uuid;
  protocolVersion: number;
  operation: Operation;
}

export interface Rejection {
  /** The operation id. */
  id: Uuid;
  table: string;
  rowId: Uuid;
  reason: RejectionReason;
  message: string;
  at: string;
}

export interface Meta {
  key: 'deviceId' | 'cursor' | 'lastSyncedAt';
  value: string;
}

export const DATA_TABLES: PullTable[] = ['member', 'device', 'category', 'flow', 'flowAmount', 'flowAllocation', 'occurrence', 'balanceSnapshot', 'goal'];

export class LocalDb extends Dexie {
  member!: Table<RowsByTable['member'], Uuid>;
  device!: Table<RowsByTable['device'], Uuid>;
  category!: Table<RowsByTable['category'], Uuid>;
  flow!: Table<RowsByTable['flow'], Uuid>;
  flowAmount!: Table<RowsByTable['flowAmount'], Uuid>;
  flowAllocation!: Table<RowsByTable['flowAllocation'], Uuid>;
  occurrence!: Table<RowsByTable['occurrence'], Uuid>;
  balanceSnapshot!: Table<RowsByTable['balanceSnapshot'], Uuid>;
  goal!: Table<RowsByTable['goal'], Uuid>;
  outbox!: Table<OutboxEntry, number>;
  rejection!: Table<Rejection, Uuid>;
  meta!: Table<Meta, Meta['key']>;

  constructor(name = 'homemgmt') {
    super(name);
    this.version(1).stores({
      member: 'id',
      device: 'id',
      category: 'id',
      flow: 'id',
      flowAmount: 'id, flowId',
      flowAllocation: 'id, flowId',
      occurrence: 'id, flowId, dueDate',
      balanceSnapshot: 'id, asOf',
      goal: 'id',
      outbox: '++seq, rowId',
      rejection: 'id',
      meta: 'key',
    });
  }

  rows<T extends PullTable>(table: T): Table<RowsByTable[T], Uuid> {
    return this.table(table) as Table<RowsByTable[T], Uuid>;
  }
}
