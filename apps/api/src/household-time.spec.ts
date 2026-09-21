import { todayIn } from './household-time';

describe('todayIn', () => {
  it('is the household calendar day, not the UTC one', () => {
    // 20:00 UTC on 31 May is already 1 June in India.
    const instant = new Date('2026-05-31T20:00:00Z');
    expect(todayIn('Asia/Kolkata', instant)).toBe('2026-06-01');
    expect(todayIn('UTC', instant)).toBe('2026-05-31');
  });
});
