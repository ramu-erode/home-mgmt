import type { CivilDate } from '@home-mgmt/shared';
import type { FlowRow, OccurrenceRow } from '../data/rows';
import type { FlowView } from '../flows/flow-model';
import { forecastItems, horizon } from './forecast-items';

const today = '2026-09-21' as CivilDate;
const meta = { version: '1', deletedAt: null };

const flowRow = (id: string, extra: Partial<FlowRow> = {}): FlowRow => ({
  id, name: id, categoryId: null, direction: 'OUT', recurrenceKind: 'INTERVAL', freq: 'MONTHLY', interval: 1,
  months: null, dayOfMonth: 5, startDate: '2026-01-05' as CivilDate, endDate: null, ...meta, ...extra,
});
const view = (row: FlowRow, amount = '2500.00'): FlowView => ({
  flow: row,
  amounts: [{ id: `${row.id}-a`, flowId: row.id, effectiveFrom: '2026-01-01' as CivilDate, amount: amount as never, ...meta }],
  allocations: [],
});
const occ = (id: string, flowId: string, ruleDate: string, extra: Partial<OccurrenceRow> = {}): OccurrenceRow => ({
  id, flowId, ruleDate: ruleDate as CivilDate, dueDate: ruleDate as CivilDate, amount: '2500.00' as never, status: 'PLANNED',
  isAmountOverridden: false, isDateOverridden: false, settledOn: null, settledAmount: null, note: null, ...meta, ...extra,
});

describe('horizon', () => {
  it('matches the server: this month and seventeen more', () => {
    expect(horizon(today)).toEqual({ from: '2026-09-01', to: '2028-02-29' });
  });
});

describe('forecastItems', () => {
  it('uses the Mac\'s rows as they are for a flow with nothing unsynced', () => {
    const f = flowRow('swim');
    const items = forecastItems({ flowRows: [f], flows: [view(f)], occurrences: [occ('o1', 'swim', '2026-10-05')], pendingFlowIds: new Set(), today });
    expect(items).toMatchObject([{ id: 'o1', direction: 'OUT', preview: false }]);
  });

  it('previews all 18 months of a flow created on this phone and not yet synced', () => {
    const f = flowRow('new');
    const items = forecastItems({ flowRows: [f], flows: [view(f)], occurrences: [], pendingFlowIds: new Set(['new']), today });
    expect(items).toHaveLength(18);
    expect(items.every((i) => i.preview)).toBe(true);
    expect(items[0]).toMatchObject({ dueDate: '2026-09-05', amount: '2500.00' });
  });

  it('an unsynced fee change moves PLANNED rows but not a CONFIRMED one — as the Mac will', () => {
    const f = flowRow('swim');
    const rows = [occ('oct', 'swim', '2026-10-05', { status: 'CONFIRMED' }), occ('nov', 'swim', '2026-11-05')];
    const items = forecastItems({ flowRows: [f], flows: [view(f, '3000.00')], occurrences: rows, pendingFlowIds: new Set(['swim']), today });
    expect(items.find((i) => i.id === 'oct')?.amount).toBe('2500.00');
    expect(items.find((i) => i.id === 'nov')).toMatchObject({ amount: '3000.00', preview: false });
    expect(items.filter((i) => i.preview).length).toBe(16); // the other months the phone has no rows for
  });

  it('a flow deleted on this phone keeps only its settled history', () => {
    const f = flowRow('gone', { deletedAt: '2026-09-21T00:00:00Z' });
    const rows = [occ('paid', 'gone', '2026-09-05', { status: 'SETTLED' }), occ('plan', 'gone', '2026-10-05')];
    const items = forecastItems({ flowRows: [f], flows: [], occurrences: rows, pendingFlowIds: new Set(['gone']), today });
    expect(items.map((i) => i.id)).toEqual(['paid']);
  });

  it('drops PLANNED rows of a tombstoned flow even with nothing pending — whatever deleted it', () => {
    const f = flowRow('orphan', { deletedAt: '2026-09-01T00:00:00Z' });
    const rows = [occ('paid', 'orphan', '2026-08-05', { status: 'SETTLED' }), occ('stale', 'orphan', '2026-10-05')];
    const items = forecastItems({ flowRows: [f], flows: [], occurrences: rows, pendingFlowIds: new Set(), today });
    expect(items.map((i) => i.id)).toEqual(['paid']);
  });

  it('a pending flow the engine cannot expand yet keeps its rows unchanged', () => {
    const f = flowRow('noamount');
    const noAmounts: FlowView = { flow: f, amounts: [], allocations: [] };
    const items = forecastItems({ flowRows: [f], flows: [noAmounts], occurrences: [occ('o', 'noamount', '2026-10-05')], pendingFlowIds: new Set(['noamount']), today });
    expect(items.map((i) => i.id)).toEqual(['o']);
  });
});
