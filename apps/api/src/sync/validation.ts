import { isCivilDate, isMoney, SYNC_TABLES, type Operation, type OccurrenceCommand, type SyncTable } from '@home-mgmt/shared';

/**
 * Validation for incoming operations. Pure; the database's own constraints
 * (kind-specific flow fields, settlement, foreign keys) are the second line
 * and surface as `invalid` too.
 *
 * Rows are whole-row upserts (ADR-009): every column must be present — `null`
 * where nullable — and nothing else may be. A missing column is a client bug,
 * not an instruction to keep the old value.
 */
type Check = (v: unknown) => boolean;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const orNull = (c: Check): Check => (v) => v === null || c(v);
const text: Check = (v) => typeof v === 'string' && v.trim() !== '';
const int: Check = (v) => Number.isInteger(v) && Math.abs(v as number) <= 32767;
const positiveInt: Check = (v) => int(v) && (v as number) > 0;
const uuid: Check = (v) => typeof v === 'string' && UUID.test(v);
const date: Check = (v) => typeof v === 'string' && isCivilDate(v);
const money: Check = (v) => typeof v === 'string' && isMoney(v);
const oneOf = (...values: string[]): Check => (v) => typeof v === 'string' && values.includes(v);
const months: Check = (v) => Array.isArray(v) && v.length > 0 && v.every((m) => Number.isInteger(m) && m >= 1 && m <= 12);

export const COLUMNS: Record<SyncTable, Record<string, Check>> = {
  member: { name: text, displayOrder: int },
  device: { name: text, memberId: orNull(uuid) },
  category: { name: text, parentId: orNull(uuid) },
  flow: {
    name: text,
    categoryId: orNull(uuid),
    direction: oneOf('OUT', 'IN'),
    recurrenceKind: oneOf('INTERVAL', 'MONTHS', 'ONE_OFF'),
    freq: orNull(oneOf('MONTHLY', 'YEARLY')),
    interval: orNull(positiveInt),
    months: orNull(months),
    dayOfMonth: orNull(positiveInt),
    startDate: date,
    endDate: orNull(date),
  },
  flowAmount: { flowId: uuid, effectiveFrom: date, amount: money },
  flowAllocation: { flowId: uuid, memberId: uuid, weight: positiveInt },
  balanceSnapshot: { asOf: date, balance: money, reservedAmount: money },
  goal: { name: text, memberId: orNull(uuid), targetAmount: money, targetDate: date, savedAmount: money, priority: int },
};

export type Validated = { ok: true; operation: Operation } | { ok: false; id: string; message: string };

export function validateOperation(raw: unknown): Validated {
  const op = raw as Record<string, unknown>;
  const id = typeof op?.['id'] === 'string' ? op['id'] : '';
  const fail = (message: string): Validated => ({ ok: false, id, message });

  if (!uuid(id)) return fail('operation id must be a UUID');
  if (typeof op['clientUpdatedAt'] !== 'string' || !ISO_INSTANT.test(op['clientUpdatedAt'])) return fail('clientUpdatedAt must be ISO-8601 with an offset');

  if (op['table'] === 'occurrence') return validateCommand(op, fail);
  if (!SYNC_TABLES.includes(op['table'] as SyncTable)) return fail(`unknown table ${String(op['table'])}`);

  const table = op['table'] as SyncTable;
  const payload = op['payload'] as Record<string, unknown> | undefined;
  if (!payload || !uuid(payload['id'])) return fail('payload.id must be a UUID');
  if (op['op'] === 'delete') return { ok: true, operation: { ...op, payload: { id: payload['id'] } } as Operation };
  if (op['op'] !== 'upsert') return fail(`op must be upsert or delete for ${table}`);

  const problem = rowProblem(table, payload);
  return problem ? fail(problem) : { ok: true, operation: op as unknown as Operation };
}

function rowProblem(table: SyncTable, payload: Record<string, unknown>): string | null {
  const columns = COLUMNS[table];
  for (const [column, check] of Object.entries(columns)) {
    if (!(column in payload)) return `${table}.${column} is missing`;
    if (!check(payload[column])) return `${table}.${column} is invalid: ${JSON.stringify(payload[column])}`;
  }
  const extra = Object.keys(payload).filter((k) => k !== 'id' && !(k in columns));
  return extra.length ? `${table} has unknown columns: ${extra.join(', ')}` : null;
}

function validateCommand(op: Record<string, unknown>, fail: (m: string) => Validated): Validated {
  if (op['op'] !== 'command') return fail('occurrences change only through commands');
  if (!uuid(op['occurrenceId'])) return fail('occurrenceId must be a UUID');
  const args = (op['args'] ?? {}) as Record<string, unknown>;
  const problem = commandProblem(op['command'] as OccurrenceCommand['command'], args);
  return problem ? fail(problem) : { ok: true, operation: op as unknown as Operation };
}

function commandProblem(command: string, args: Record<string, unknown>): string | null {
  switch (command) {
    case 'confirm':
    case 'skip':
    case 'unskip':
      return null;
    case 'settle':
      return date(args['on']) && money(args['amount']) ? null : 'settle needs args.on (date) and args.amount (money)';
    case 'override':
      if (args['amount'] !== undefined && !money(args['amount'])) return 'override args.amount must be money';
      if (args['dueDate'] !== undefined && !date(args['dueDate'])) return 'override args.dueDate must be a date';
      return null;
    case 'note':
      return args['text'] === null || typeof args['text'] === 'string' ? null : 'note needs args.text (string or null)';
    default:
      return `unknown command ${command}`;
  }
}
