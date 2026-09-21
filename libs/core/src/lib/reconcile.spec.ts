import type { ExpectedOccurrence } from '@home-mgmt/shared';
import { reconcile } from './reconcile';
import { d, m, occurrence } from '../testing/builders';

const scope = { flowIds: ['f'], from: d('2026-09-01'), to: d('2026-12-31') };
const exp = (ruleDate: string, amount = '1000.00'): ExpectedOccurrence => ({ flowId: 'f', direction: 'OUT', ruleDate: d(ruleDate), amount: m(amount) });

describe('reconcile — the ADR-003 invariant', () => {
  it('inserts dates the rule produces that have no row', () => {
    const plan = reconcile(scope, [exp('2026-09-01'), exp('2026-10-01')], [occurrence({ id: '1', flowId: 'f', ruleDate: d('2026-09-01') })]);
    expect(plan.insert.map((e) => e.ruleDate)).toEqual(['2026-10-01']);
  });

  it('is idempotent: running it on its own result changes nothing', () => {
    const rows = [occurrence({ id: '1', flowId: 'f', ruleDate: d('2026-09-01') })];
    expect(reconcile(scope, [exp('2026-09-01')], rows)).toEqual({ insert: [], updateAmount: [], softDelete: [] });
  });

  it('updates the amount of a PLANNED, un-overridden row', () => {
    const rows = [occurrence({ id: '1', flowId: 'f', ruleDate: d('2026-09-01') })];
    expect(reconcile(scope, [exp('2026-09-01', '1100.00')], rows).updateAmount).toEqual([{ id: '1', amount: '1100.00' }]);
  });

  it('soft-deletes a PLANNED, un-overridden row the rule no longer produces', () => {
    const rows = [occurrence({ id: '1', flowId: 'f', ruleDate: d('2026-11-01') })];
    expect(reconcile(scope, [], rows).softDelete).toEqual(['1']);
  });

  it.each([
    ['CONFIRMED', { status: 'CONFIRMED' as const }],
    ['SETTLED', { status: 'SETTLED' as const }],
    ['SKIPPED', { status: 'SKIPPED' as const }],
    ['amount-overridden', { isAmountOverridden: true, amount: m('999.00') }],
    ['date-overridden', { isDateOverridden: true, dueDate: d('2026-11-05') }],
  ])('leaves a %s row exactly as it is', (_, extra) => {
    const row = occurrence({ id: '1', flowId: 'f', ruleDate: d('2026-11-01'), ...extra });
    // Amount changed by the rule, and in a second run the rule drops the date entirely.
    expect(reconcile(scope, [exp('2026-11-01', '5000.00')], [row])).toEqual({ insert: [], updateAmount: [], softDelete: [] });
    expect(reconcile(scope, [], [row])).toEqual({ insert: [], updateAmount: [], softDelete: [] });
  });

  it('matches on ruleDate, so a moved due date is not re-inserted', () => {
    const moved = occurrence({ id: '1', flowId: 'f', ruleDate: d('2026-11-01'), dueDate: d('2026-11-05'), isDateOverridden: true });
    expect(reconcile(scope, [exp('2026-11-01')], [moved]).insert).toEqual([]);
  });

  it('never touches rows outside the scope — other flows, or history before the window', () => {
    const rows = [
      occurrence({ id: 'other', flowId: 'g', ruleDate: d('2026-10-01') }),
      occurrence({ id: 'past', flowId: 'f', ruleDate: d('2026-08-01') }),
    ];
    expect(reconcile(scope, [], rows)).toEqual({ insert: [], updateAmount: [], softDelete: [] });
  });

  it('re-inserts a date whose earlier row was tombstoned (tombstones are not passed in)', () => {
    // The caller passes live rows only; a tombstone on 2026-10-01 must not block
    // regeneration — which is why the unique index is partial (ADR-007).
    expect(reconcile(scope, [exp('2026-10-01')], []).insert).toHaveLength(1);
  });
});
