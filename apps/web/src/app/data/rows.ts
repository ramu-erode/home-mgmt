import type { CivilDate, Direction, Freq, Money, OccurrenceStatus, RecurrenceKind, Uuid } from '@home-mgmt/shared';

/**
 * Rows as held in IndexedDB: exactly what a pull returns (camelCase, money and
 * dates as strings), so a pulled row can be stored without translation. Local
 * writes carry the same shape; `version` is the last server version seen and
 * stays as it was until the next pull brings the server's copy.
 */
export interface SyncMeta {
  version: string;
  deletedAt: string | null;
}

export type MemberRow = SyncMeta & { id: Uuid; name: string; displayOrder: number };
export type DeviceRow = SyncMeta & { id: Uuid; name: string; memberId: Uuid | null };
export type CategoryRow = SyncMeta & { id: Uuid; name: string; parentId: Uuid | null };

export type FlowRow = SyncMeta & {
  id: Uuid;
  name: string;
  categoryId: Uuid | null;
  direction: Direction;
  recurrenceKind: RecurrenceKind;
  freq: Freq | null;
  interval: number | null;
  months: number[] | null;
  dayOfMonth: number | null;
  startDate: CivilDate;
  endDate: CivilDate | null;
};

export type FlowAmountRow = SyncMeta & { id: Uuid; flowId: Uuid; effectiveFrom: CivilDate; amount: Money };
export type FlowAllocationRow = SyncMeta & { id: Uuid; flowId: Uuid; memberId: Uuid; weight: number };

export type OccurrenceRow = SyncMeta & {
  id: Uuid;
  flowId: Uuid;
  ruleDate: CivilDate;
  dueDate: CivilDate;
  amount: Money;
  status: OccurrenceStatus;
  isAmountOverridden: boolean;
  isDateOverridden: boolean;
  settledOn: CivilDate | null;
  settledAmount: Money | null;
  note: string | null;
};

export type BalanceSnapshotRow = SyncMeta & { id: Uuid; asOf: CivilDate; balance: Money; reservedAmount: Money };
export type GoalRow = SyncMeta & {
  id: Uuid;
  name: string;
  memberId: Uuid | null;
  targetAmount: Money;
  targetDate: CivilDate;
  savedAmount: Money;
  priority: number;
};

export interface RowsByTable {
  member: MemberRow;
  device: DeviceRow;
  category: CategoryRow;
  flow: FlowRow;
  flowAmount: FlowAmountRow;
  flowAllocation: FlowAllocationRow;
  occurrence: OccurrenceRow;
  balanceSnapshot: BalanceSnapshotRow;
  goal: GoalRow;
}

/** A row as the app edits it — without the sync metadata the store manages. */
export type Draft<T extends keyof RowsByTable> = Omit<RowsByTable[T], keyof SyncMeta>;

export const isLive = (row: SyncMeta) => row.deletedAt === null;
