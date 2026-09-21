import { civilDate, daysInMonth, isCivilDate, isMoney, money, yearMonth } from './values';

describe('money', () => {
  it('accepts two-decimal strings, including negatives', () => {
    expect(money('40000.00')).toBe('40000.00');
    expect(money('-0.50')).toBe('-0.50');
  });

  it('rejects floats, integers and extra precision', () => {
    for (const bad of ['40000', '40000.0', '1.005', '1e3', '', ' 1.00']) {
      expect(isMoney(bad)).toBe(false);
    }
    expect(() => money('12.5')).toThrow(TypeError);
  });
});

describe('civilDate', () => {
  it('accepts real calendar days', () => {
    expect(civilDate('2026-06-30')).toBe('2026-06-30');
    expect(isCivilDate('2028-02-29')).toBe(true);
  });

  it('rejects impossible days and non-dates', () => {
    for (const bad of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-6-1', '2026-06-01T00:00:00Z']) {
      expect(isCivilDate(bad)).toBe(false);
    }
  });
});

describe('yearMonth', () => {
  it('validates', () => {
    expect(yearMonth('2026-09')).toBe('2026-09');
    expect(() => yearMonth('2026-9')).toThrow(TypeError);
  });
});

describe('daysInMonth', () => {
  it('knows leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});
