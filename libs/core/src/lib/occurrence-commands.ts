import type { CivilDate, Money, OccurrenceCommand, OccurrenceStatus } from '@home-mgmt/shared';

/**
 * Occurrence commands as pure state transitions (ADR-009). The server applies
 * them to the row as it is when the command arrives; a phone can apply the same
 * function to its local copy and predict the outcome exactly.
 *
 * A command is rejected only when it is genuinely impossible — the reason goes
 * back to the phone and is shown to the person (ADR-009: every rejection is
 * visible).
 */
export interface OccurrenceState {
  status: OccurrenceStatus;
  amount: Money;
  dueDate: CivilDate;
  isAmountOverridden: boolean;
  isDateOverridden: boolean;
  settledOn: CivilDate | null;
  settledAmount: Money | null;
  note: string | null;
  /** Tombstoned — typically by regeneration after a rule change. */
  deleted: boolean;
}

export type CommandRejection = 'gone' | 'settled' | 'skipped' | 'not-skipped' | 'empty-override';

export type CommandResult =
  | { ok: true; patch: Partial<OccurrenceState> }
  | { ok: false; reason: CommandRejection };

export const REJECTION_MESSAGES: Record<CommandRejection, string> = {
  gone: 'This occurrence no longer exists — the rule was changed.',
  settled: 'Already settled.',
  skipped: 'Skipped — unskip it first.',
  'not-skipped': 'Not skipped.',
  'empty-override': 'An override needs an amount or a date.',
};

export function applyCommand(state: OccurrenceState, cmd: OccurrenceCommand): CommandResult {
  if (state.deleted) return reject('gone');
  switch (cmd.command) {
    case 'confirm':
      return blockedBy(state, ['SETTLED', 'SKIPPED']) ?? ok({ status: 'CONFIRMED' });
    case 'settle':
      // Re-settling a settled occurrence corrects the recorded payment.
      return blockedBy(state, ['SKIPPED']) ?? ok({ status: 'SETTLED', settledOn: cmd.args.on, settledAmount: cmd.args.amount });
    case 'skip':
      return blockedBy(state, ['SETTLED']) ?? ok({ status: 'SKIPPED' });
    case 'unskip':
      return state.status === 'SKIPPED' ? ok({ status: 'PLANNED' }) : reject('not-skipped');
    case 'override':
      return blockedBy(state, ['SETTLED']) ?? override(cmd.args);
    case 'note':
      return ok({ note: cmd.args.text });
  }
}

function override(args: { amount?: Money; dueDate?: CivilDate }): CommandResult {
  if (args.amount === undefined && args.dueDate === undefined) return reject('empty-override');
  return ok({
    ...(args.amount !== undefined && { amount: args.amount, isAmountOverridden: true }),
    ...(args.dueDate !== undefined && { dueDate: args.dueDate, isDateOverridden: true }),
  });
}

function blockedBy(state: OccurrenceState, statuses: OccurrenceStatus[]): CommandResult | null {
  if (!statuses.includes(state.status)) return null;
  return reject(state.status === 'SETTLED' ? 'settled' : 'skipped');
}

const ok = (patch: Partial<OccurrenceState>): CommandResult => ({ ok: true, patch });
const reject = (reason: CommandRejection): CommandResult => ({ ok: false, reason });
