import { SYNC_COLUMNS, SYNC_TABLES } from '@home-mgmt/shared';
import { COLUMNS, validateOperation } from './validation';

describe('column contract', () => {
  it.each(SYNC_TABLES)('the server validates exactly the columns the client sends for %s', (table) => {
    expect(Object.keys(COLUMNS[table]).sort()).toEqual([...SYNC_COLUMNS[table]].sort());
  });
});

const base = { id: '11111111-1111-4111-8111-111111111111', clientUpdatedAt: '2026-09-21T10:00:00.000+05:30' };
const memberRow = { id: '22222222-2222-4222-8222-222222222222', name: 'Child 1', displayOrder: 3 };

describe('validateOperation', () => {
  it('accepts a whole-row upsert', () => {
    expect(validateOperation({ ...base, table: 'member', op: 'upsert', payload: memberRow }).ok).toBe(true);
  });

  it.each([
    ['a missing column — whole rows only', { ...memberRow, displayOrder: undefined }],
    ['an unknown column', { ...memberRow, email: 'x@y' }],
    ['an empty name', { ...memberRow, name: '  ' }],
  ])('rejects %s', (_, payload) => {
    const clean = JSON.parse(JSON.stringify(payload));
    expect(validateOperation({ ...base, table: 'member', op: 'upsert', payload: clean }).ok).toBe(false);
  });

  it('rejects float money and non-calendar dates', () => {
    const amount = { id: memberRow.id, flowId: memberRow.id, effectiveFrom: '2026-06-01', amount: 40000 };
    expect(validateOperation({ ...base, table: 'flowAmount', op: 'upsert', payload: amount }).ok).toBe(false);
    expect(validateOperation({ ...base, table: 'flowAmount', op: 'upsert', payload: { ...amount, amount: '40000.00', effectiveFrom: '2026-02-30' } }).ok).toBe(false);
  });

  it('rejects a clientUpdatedAt without an offset — it would be read in server time', () => {
    expect(validateOperation({ ...base, clientUpdatedAt: '2026-09-21T10:00:00', table: 'member', op: 'upsert', payload: memberRow }).ok).toBe(false);
  });

  it('refuses row writes to occurrences', () => {
    expect(validateOperation({ ...base, table: 'occurrence', op: 'upsert', payload: { id: memberRow.id } }).ok).toBe(false);
  });

  it('validates command arguments', () => {
    const cmd = { ...base, table: 'occurrence', op: 'command', occurrenceId: memberRow.id };
    expect(validateOperation({ ...cmd, command: 'confirm' }).ok).toBe(true);
    expect(validateOperation({ ...cmd, command: 'settle', args: { on: '2026-10-01', amount: '100.00' } }).ok).toBe(true);
    expect(validateOperation({ ...cmd, command: 'settle', args: { on: '2026-10-01' } }).ok).toBe(false);
    expect(validateOperation({ ...cmd, command: 'explode' }).ok).toBe(false);
  });

  it('accepts a delete with just the id', () => {
    expect(validateOperation({ ...base, table: 'goal', op: 'delete', payload: { id: memberRow.id } }).ok).toBe(true);
  });
});
