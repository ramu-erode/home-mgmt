import { columnPath, labelsFit, linear, niceTicks } from './chart-geometry';

describe('chart geometry', () => {
  it('produces round ticks that include zero and cover the range', () => {
    // 80,999 / 4 = 20,250 per step → the next nice step up is 25,000.
    expect(niceTicks(0, 80999)).toEqual([0, 25000, 50000, 75000, 100000]);
    expect(niceTicks(0, 80999, 3)).toEqual([0, 50000, 100000]);
    const withNegative = niceTicks(-20082, 480000);
    expect(withNegative[0]).toBeLessThanOrEqual(-20082);
    expect(withNegative).toContain(0);
    expect(withNegative[withNegative.length - 1]).toBeGreaterThanOrEqual(480000);
  });

  it('handles a flat zero series', () => {
    expect(niceTicks(0, 0)).toEqual([0, 1]);
  });

  it('maps linearly, including inverted pixel ranges', () => {
    const y = linear(0, 100, 200, 0);
    expect(y(0)).toBe(200);
    expect(y(50)).toBe(100);
  });

  it('draws nothing for a zero-height column and never over-rounds a short one', () => {
    expect(columnPath(10, 12, 100, 100)).toBe('');
    expect(columnPath(10, 12, 98, 100)).toContain('Q10,98 12,98'); // radius clamped to the 2px height
  });

  it('detects colliding end labels', () => {
    expect(labelsFit([10, 40, 80], 12)).toBe(true);
    expect(labelsFit([10, 18, 80], 12)).toBe(false);
  });
});
