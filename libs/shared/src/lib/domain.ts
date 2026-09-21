import type { CivilDate, Money, Uuid } from './values';

/**
 * Domain shapes shared by api, web and the projection engine. Field names are
 * camelCase; the database is snake_case and the data layer maps between them.
 * Sync metadata (version, client_updated_at, …) is not part of these shapes —
 * it belongs to the sync DTOs, not to the domain.
 */

export type Direction = 'OUT' | 'IN';
export type RecurrenceKind = 'INTERVAL' | 'MONTHS' | 'ONE_OFF';
export type Freq = 'MONTHLY' | 'YEARLY';
export type OccurrenceStatus = 'PLANNED' | 'CONFIRMED' | 'SETTLED' | 'SKIPPED';

/** A scheduled amount, in force from `effectiveFrom` until the next one. */
export interface FlowAmount {
  effectiveFrom: CivilDate;
  amount: Money;
}

/** A member's share of a flow. No allocations at all means household. */
export interface FlowAllocation {
  memberId: Uuid;
  weight: number;
}

/**
 * The recurrence rule (ADR-003, ADR-010, ADR-013).
 *
 * - INTERVAL: every `interval` months (MONTHLY) or years (YEARLY), counted from
 *   the month of `startDate`, on `dayOfMonth` clamped to month-end.
 * - MONTHS:   in each listed month of every year, on `dayOfMonth`, clamped.
 * - ONE_OFF:  once, on `startDate`.
 *
 * No occurrence falls before `startDate` or after `endDate`.
 */
export interface Flow {
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
  amounts: FlowAmount[];
  allocations: FlowAllocation[];
}

/**
 * A materialised instance. `ruleDate` is the date the rule produced and never
 * changes; `dueDate` starts equal to it and moves only by a date override.
 * Regeneration matches on `(flowId, ruleDate)` — matching on `dueDate` would
 * re-insert the rule date of every row whose date was overridden.
 */
export interface Occurrence {
  id: Uuid;
  flowId: Uuid;
  direction: Direction;
  ruleDate: CivilDate;
  dueDate: CivilDate;
  amount: Money;
  status: OccurrenceStatus;
  isAmountOverridden: boolean;
  isDateOverridden: boolean;
}

/** What the rule says should exist — before any row or status is attached. */
export interface ExpectedOccurrence {
  flowId: Uuid;
  direction: Direction;
  ruleDate: CivilDate;
  amount: Money;
}

/**
 * The minimum the forecast needs from an occurrence. Server rows and phone
 * previews (ADR-009) both satisfy it; a preview has no status and counts as
 * PLANNED.
 */
export interface ForecastItem {
  flowId: Uuid;
  direction: Direction;
  dueDate: CivilDate;
  amount: Money;
  status?: OccurrenceStatus;
}

/**
 * Everything a phone may do to an occurrence (ADR-009). Phones never insert or
 * delete occurrences and never send whole rows; the server applies a command
 * to the row as it is when the command arrives.
 */
export type OccurrenceCommand =
  | { command: 'confirm' }
  | { command: 'settle'; args: { on: CivilDate; amount: Money } }
  | { command: 'skip' }
  | { command: 'unskip' }
  | { command: 'override'; args: { amount?: Money; dueDate?: CivilDate } }
  | { command: 'note'; args: { text: string | null } };

export type OccurrenceCommandName = OccurrenceCommand['command'];

/**
 * The projection anchor. `balance = reservedAmount + Σ goal.savedAmount + free`
 * (ADR-011); the engine refuses a snapshot whose earmarks exceed the balance.
 */
export interface BalanceSnapshot {
  asOf: CivilDate;
  balance: Money;
  reservedAmount: Money;
}

export interface Goal {
  id: Uuid;
  name: string;
  memberId: Uuid | null;
  targetAmount: Money;
  targetDate: CivilDate;
  savedAmount: Money;
  /** Lower number is funded first. */
  priority: number;
}
