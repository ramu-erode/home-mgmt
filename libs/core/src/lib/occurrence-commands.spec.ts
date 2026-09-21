import { applyCommand, type OccurrenceState } from './occurrence-commands';
import { d, m } from '../testing/builders';

const planned: OccurrenceState = {
  status: 'PLANNED',
  amount: m('40000.00'),
  dueDate: d('2026-10-05'),
  isAmountOverridden: false,
  isDateOverridden: false,
  settledOn: null,
  settledAmount: null,
  note: null,
  deleted: false,
};
const as = (overrides: Partial<OccurrenceState>) => ({ ...planned, ...overrides });

describe('occurrence commands', () => {
  it('confirm takes the row as it is — it does not carry an amount', () => {
    expect(applyCommand(as({ amount: m('42000.00') }), { command: 'confirm' })).toEqual({ ok: true, patch: { status: 'CONFIRMED' } });
  });

  it('settle records the payment, and a second settle corrects it', () => {
    const settle = { command: 'settle' as const, args: { on: d('2026-10-04'), amount: m('39500.00') } };
    expect(applyCommand(planned, settle)).toEqual({ ok: true, patch: { status: 'SETTLED', settledOn: '2026-10-04', settledAmount: '39500.00' } });
    expect(applyCommand(as({ status: 'SETTLED' }), settle).ok).toBe(true);
  });

  it('skip and unskip round-trip', () => {
    expect(applyCommand(as({ status: 'CONFIRMED' }), { command: 'skip' })).toEqual({ ok: true, patch: { status: 'SKIPPED' } });
    expect(applyCommand(as({ status: 'SKIPPED' }), { command: 'unskip' })).toEqual({ ok: true, patch: { status: 'PLANNED' } });
  });

  it('override sets exactly the flags for what it changes', () => {
    expect(applyCommand(planned, { command: 'override', args: { amount: m('45000.00') } }))
      .toEqual({ ok: true, patch: { amount: '45000.00', isAmountOverridden: true } });
    expect(applyCommand(planned, { command: 'override', args: { dueDate: d('2026-10-10') } }))
      .toEqual({ ok: true, patch: { dueDate: '2026-10-10', isDateOverridden: true } });
  });

  it('a note is allowed on anything that still exists', () => {
    expect(applyCommand(as({ status: 'SETTLED' }), { command: 'note', args: { text: 'paid by cheque' } }).ok).toBe(true);
  });

  it.each([
    ['confirm a settled occurrence', as({ status: 'SETTLED' }), { command: 'confirm' as const }, 'settled'],
    ['confirm a skipped occurrence', as({ status: 'SKIPPED' }), { command: 'confirm' as const }, 'skipped'],
    ['settle a skipped occurrence', as({ status: 'SKIPPED' }), { command: 'settle' as const, args: { on: d('2026-10-01'), amount: m('1.00') } }, 'skipped'],
    ['skip a settled occurrence', as({ status: 'SETTLED' }), { command: 'skip' as const }, 'settled'],
    ['unskip one that is not skipped', planned, { command: 'unskip' as const }, 'not-skipped'],
    ['override a settled occurrence', as({ status: 'SETTLED' }), { command: 'override' as const, args: { amount: m('1.00') } }, 'settled'],
    ['override with nothing', planned, { command: 'override' as const, args: {} }, 'empty-override'],
    ['anything on a tombstoned occurrence', as({ deleted: true }), { command: 'note' as const, args: { text: 'x' } }, 'gone'],
  ])('rejects: %s', (_, state, cmd, reason) => {
    expect(applyCommand(state, cmd)).toEqual({ ok: false, reason });
  });
});
