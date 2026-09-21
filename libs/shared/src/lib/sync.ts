import type { OccurrenceCommand } from './domain';
import type { Uuid } from './values';

/**
 * The sync protocol (ADR-009). Both ends import these shapes, so a change here
 * is a protocol change: bump PROTOCOL_VERSION, keep accepting the previous
 * version on the server, and migrate expand-then-contract.
 */
export const PROTOCOL_VERSION = 1;
/** Oldest client protocol the server still accepts (current and one before). */
export const MIN_PROTOCOL_VERSION = 1;

export const PROTOCOL_HEADER = 'x-protocol-version';
export const DEVICE_HEADER = 'x-device-id';

/** Human-authored tables: whole-row upsert or delete, last-write-wins. */
export const SYNC_TABLES = ['member', 'device', 'category', 'flow', 'flowAmount', 'flowAllocation', 'balanceSnapshot', 'goal'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/** Everything a pull can return — occurrences come down but only commands go up. */
export type PullTable = SyncTable | 'occurrence';

interface OperationBase {
  /** Outbox entry id — `applied` and `rejected` refer to it. */
  id: Uuid;
  /** ISO-8601 with offset, from the device's clock. Decides last-write-wins. */
  clientUpdatedAt: string;
}

export interface UpsertOperation extends OperationBase {
  table: SyncTable;
  op: 'upsert';
  /** The whole row, camelCase, without sync metadata. */
  payload: { id: Uuid } & Record<string, unknown>;
}

export interface DeleteOperation extends OperationBase {
  table: SyncTable;
  op: 'delete';
  payload: { id: Uuid };
}

export type CommandOperation = OperationBase & {
  table: 'occurrence';
  op: 'command';
  occurrenceId: Uuid;
} & OccurrenceCommand;

export type Operation = UpsertOperation | DeleteOperation | CommandOperation;

export interface PushRequest {
  operations: Operation[];
}

export type RejectionReason =
  /** A newer write to the same row already won. */
  | 'stale'
  /** The payload or command failed validation or a database constraint. */
  | 'invalid'
  /** Occurrence commands — see REJECTION_MESSAGES in libs/core. */
  | 'gone'
  | 'settled'
  | 'skipped'
  | 'not-skipped'
  | 'empty-override';

export interface PushResponse {
  applied: Uuid[];
  rejected: { id: Uuid; reason: RejectionReason; message: string }[];
}

/** A row as stored, camelCase, with sync metadata. Money and dates are strings. */
export type SyncRow = { id: Uuid; version: string; deletedAt: string | null } & Record<string, unknown>;

export type PullResponse =
  | { resetRequired: false; cursor: string; changes: Partial<Record<PullTable, SyncRow[]>> }
  /** The cursor predates the tombstone purge: push the outbox, clear, pull from 0. */
  | { resetRequired: true };
