import type { CivilDate } from '@home-mgmt/shared';
import type { FlowView } from './flow-model';
import { blankDraft, changes, draftFrom, duplicateFor, problems, toRows, type FlowDraft } from './flow-draft';

const today = '2026-09-21' as CivilDate;
const valid = (overrides: Partial<FlowDraft> = {}): FlowDraft => ({
  ...blankDraft(today),
  name: 'School — Child 1',
  amounts: [{ id: 'a1', effectiveFrom: '2026-06-01', amountText: '40,000' }],
  ...overrides,
});

describe('flow drafts', () => {
  it('maps each cadence onto the recurrence kinds, carrying only that kind\'s fields', () => {
    expect(toRows(valid({ cadence: 'MONTHLY', interval: 4, dayOfMonth: 20 })).flow).toMatchObject({ recurrenceKind: 'INTERVAL', freq: 'MONTHLY', interval: 4, months: null, dayOfMonth: 20 });
    expect(toRows(valid({ cadence: 'YEARLY', interval: 1, dayOfMonth: 15 })).flow).toMatchObject({ recurrenceKind: 'INTERVAL', freq: 'YEARLY', interval: 1, months: null });
    expect(toRows(valid({ cadence: 'MONTHS', months: [10, 2, 6], dayOfMonth: 5 })).flow).toMatchObject({ recurrenceKind: 'MONTHS', freq: null, interval: null, months: [2, 6, 10] });
    expect(toRows(valid({ cadence: 'ONE_OFF', endDate: '2027-01-01' })).flow).toMatchObject({ recurrenceKind: 'ONE_OFF', freq: null, interval: null, months: null, dayOfMonth: null, endDate: null });
  });

  it('parses amounts as typed into exact money strings', () => {
    expect(toRows(valid()).amounts).toEqual([{ id: 'a1', flowId: expect.any(String), effectiveFrom: '2026-06-01', amount: '40000.00' }]);
  });

  it('household means no allocation rows at all (ADR-010)', () => {
    const rows = toRows(valid({ split: 'household', allocations: [{ id: 'x', memberId: 'm1', weight: 1 }] }));
    expect(rows.allocations).toEqual([]);
  });

  it.each([
    ['no name', { name: ' ' }, /name/],
    ['bad amount', { amounts: [{ id: 'a', effectiveFrom: '2026-06-01', amountText: '12.345' }] }, /not a valid amount/],
    ['no months', { cadence: 'MONTHS' as const, months: [] }, /at least one month/],
    ['end before start', { endDate: '2020-01-01' }, /end date/],
    ['members chosen but nobody picked', { split: 'members' as const, allocations: [] }, /who this is for/],
    ['two amounts on one date', { amounts: [{ id: 'a', effectiveFrom: '2026-06-01', amountText: '1' }, { id: 'b', effectiveFrom: '2026-06-01', amountText: '2' }] }, /same date/],
  ])('reports %s', (_, overrides, pattern) => {
    expect(problems(valid(overrides)).join(' ')).toMatch(pattern);
  });

  it('a valid draft has no problems', () => {
    expect(problems(valid())).toEqual([]);
  });

  it('tombstones amounts and allocations removed in the editor, and writes the flow first', () => {
    const view = {
      flow: { ...toRows(valid()).flow, version: '3', deletedAt: null },
      amounts: [
        { id: 'keep', flowId: 'f', effectiveFrom: '2026-06-01', amount: '40000.00', version: '1', deletedAt: null },
        { id: 'drop', flowId: 'f', effectiveFrom: '2027-06-01', amount: '42000.00', version: '1', deletedAt: null },
      ],
      allocations: [{ id: 'gone', flowId: 'f', memberId: 'm1', weight: 1, version: '1', deletedAt: null }],
    } as FlowView;
    const draft = { ...draftFrom(view), amounts: draftFrom(view).amounts.filter((a) => a.id === 'keep'), split: 'household' as const };
    const { writes, deletes } = changes(view, toRows(draft));
    expect(writes[0].table).toBe('flow');
    expect(deletes).toEqual([
      { table: 'flowAmount', id: 'drop' },
      { table: 'flowAllocation', id: 'gone' },
    ]);
  });

  it('duplicates a per-person fee for someone else — new ids, 100% theirs', () => {
    const view = {
      flow: { ...toRows(valid()).flow, version: '3', deletedAt: null },
      amounts: [{ id: 'a1', flowId: 'f', effectiveFrom: '2026-06-01', amount: '40000.00', version: '1', deletedAt: null }],
      allocations: [{ id: 'al', flowId: 'f', memberId: 'child1', weight: 1, version: '1', deletedAt: null }],
    } as FlowView;
    const copy = duplicateFor(view, 'child2', 'Child 2');
    expect(copy.name).toBe('School — Child 2');
    expect(copy.id).not.toBe(view.flow.id);
    expect(copy.amounts[0].id).not.toBe('a1');
    expect(copy.allocations).toEqual([{ id: expect.any(String), memberId: 'child2', weight: 1 }]);
  });
});
