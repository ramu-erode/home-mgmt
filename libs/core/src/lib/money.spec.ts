import Big from 'big.js';
import { ceilRupee, D, dec, split, sum, toMoney } from './money';
import { m } from '../testing/builders';

describe('money arithmetic', () => {
  it('is exact where floats are not', () => {
    expect(toMoney(sum([dec(m('0.10')), dec(m('0.20'))]))).toBe('0.30');
    expect(toMoney(D('2500').div(3).times(3))).toBe('2500.00');
  });

  it('rounds up to the whole rupee for reserves', () => {
    expect(toMoney(ceilRupee(D('18500').div(12)))).toBe('1542.00');
    expect(toMoney(ceilRupee(D('36000').div(12)))).toBe('3000.00');
  });

  it('uses a private constructor, untouched by global big.js settings', () => {
    const before = Big.DP;
    Big.DP = 0;
    try {
      expect(D('1').div(3).toFixed(4)).toBe('0.3333');
    } finally {
      Big.DP = before;
    }
  });
});

describe('split — largest remainder', () => {
  it('always sums exactly to the total', () => {
    const shares = split(m('2500.00'), [
      { memberId: 'a', weight: 1 },
      { memberId: 'b', weight: 1 },
      { memberId: 'c', weight: 1 },
    ]);
    expect(shares.map((s) => s.amount)).toEqual(['833.34', '833.33', '833.33']);
    expect(toMoney(sum(shares.map((s) => dec(s.amount))))).toBe('2500.00');
  });

  it('gives leftover paise to the larger remainder, then the higher weight, then the lower id', () => {
    // 100.00 over 1:2 → 33.333… and 66.666…; the .666 remainder wins the paisa.
    expect(split(m('100.00'), [{ memberId: 'x', weight: 1 }, { memberId: 'y', weight: 2 }]).map((s) => s.amount))
      .toEqual(['33.33', '66.67']);
    // Equal remainders: order of input does not change who gets the paisa.
    const reversed = split(m('2500.00'), [
      { memberId: 'c', weight: 1 },
      { memberId: 'b', weight: 1 },
      { memberId: 'a', weight: 1 },
    ]);
    expect(reversed.find((s) => s.memberId === 'a')?.amount).toBe('833.34');
  });

  it('normalises weights rather than requiring them to sum to anything', () => {
    const shares = split(m('9000.00'), [{ memberId: 'a', weight: 2 }, { memberId: 'b', weight: 1 }]);
    expect(shares.map((s) => s.amount)).toEqual(['6000.00', '3000.00']);
  });

  it('puts an unallocated flow in the household bucket', () => {
    expect(split(m('1200.00'), [])).toEqual([{ memberId: null, amount: '1200.00' }]);
  });

  it('rejects non-positive weights', () => {
    expect(() => split(m('10.00'), [{ memberId: 'a', weight: 0 }])).toThrow(RangeError);
  });
});
