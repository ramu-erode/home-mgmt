import type { GoalRow } from '../data/rows';
import { addToSaved, checkSnapshot, goalProblems, goalRow, paymentProblems, paymentWrites, reprioritise, snapshotRow } from './entry-model';

const goal = (id: string, saved: string, priority = 1): GoalRow =>
  ({ id, name: id, memberId: null, targetAmount: '100000.00', targetDate: '2027-12-31', savedAmount: saved, priority, version: '1', deletedAt: null }) as GoalRow;

describe('balance snapshot', () => {
  it('splits the balance three ways, exactly', () => {
    const c = checkSnapshot({ asOf: '2026-09-22', balanceText: '2,50,000', reservedText: '30000' }, [goal('a', '50000.00'), goal('b', '0.10')]);
    expect(c).toEqual({ problems: [], free: '169999.90', goalsSaved: '50000.10' });
  });

  it('treats an empty reserve as nothing set aside', () => {
    expect(checkSnapshot({ asOf: '2026-09-22', balanceText: '1000', reservedText: '' }, []).free).toBe('1000.00');
    expect(snapshotRow('s', { asOf: '2026-09-22', balanceText: '1000', reservedText: ' ' }).reservedAmount).toBe('0.00');
  });

  it('refuses earmarks larger than the balance — the engine would', () => {
    const c = checkSnapshot({ asOf: '2026-09-22', balanceText: '10000', reservedText: '8000' }, [goal('a', '3000.00')]);
    expect(c.free).toBe('-1000.00');
    expect(c.problems.join()).toMatch(/more than the balance/);
  });

  it('needs a date and a balance', () => {
    expect(checkSnapshot({ asOf: '', balanceText: 'abc', reservedText: '' }, []).problems).toHaveLength(2);
  });
});

describe('goals', () => {
  it('validates and builds a row', () => {
    const input = { id: 'g', name: ' Car ', memberId: null, targetText: '1,50,000', targetDate: '2027-09-01', savedText: '', priority: 2 };
    expect(goalProblems(input)).toEqual([]);
    expect(goalRow(input)).toEqual({ id: 'g', name: 'Car', memberId: null, targetAmount: '150000.00', targetDate: '2027-09-01', savedAmount: '0.00', priority: 2 });
    expect(goalProblems({ ...input, targetText: '0' }).join()).toMatch(/target amount/);
  });

  it('adds to what is saved without a float in between', () => {
    expect(addToSaved(goal('g', '0.10'), '0.20')?.savedAmount).toBe('0.30');
    expect(addToSaved(goal('g', '10.00'), '0')).toBeNull();
  });

  it('reprioritises by renumbering, writing only what moved', () => {
    const goals = [goal('a', '0.00', 1), goal('b', '0.00', 2), goal('c', '0.00', 3)];
    expect(reprioritise(goals, 'c', -1).map((g) => [g.id, g.priority])).toEqual([['c', 2], ['b', 3]]);
    expect(reprioritise(goals, 'a', -1)).toEqual([]);
  });
});

describe('expected contracting payment', () => {
  const p = { client: 'Client Z', amountText: '1,20,000', expected: '2027-01-15', categoryId: null, memberId: 'm1' };

  it('is a one-off income flow with its amount and whose income it is', () => {
    const writes = paymentWrites(p, { flow: 'f', amount: 'a', allocation: 'al' });
    expect(writes.map((w) => w.table)).toEqual(['flow', 'flowAmount', 'flowAllocation']);
    expect(writes[0].draft).toMatchObject({ direction: 'IN', recurrenceKind: 'ONE_OFF', startDate: '2027-01-15', dayOfMonth: null });
    expect(writes[1].draft).toMatchObject({ amount: '120000.00', effectiveFrom: '2027-01-15' });
  });

  it('is household income when nobody is picked', () => {
    expect(paymentWrites({ ...p, memberId: null }, { flow: 'f', amount: 'a', allocation: 'al' }).map((w) => w.table)).toEqual(['flow', 'flowAmount']);
  });

  it('needs a payer, an amount and a date', () => {
    expect(paymentProblems({ ...p, client: '', amountText: 'x', expected: '' })).toHaveLength(3);
  });
});
