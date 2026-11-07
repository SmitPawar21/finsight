import { describe, expect, it } from 'vitest';
import { cagr } from './growth.js';

describe('cagr', () => {
  it('computes compound annual growth', () => {
    // 100 -> 150 over 3 years: (1.5)^(1/3) - 1
    expect(cagr(100, 150, 3)).toBeCloseTo(0.144714, 6);
  });

  it('is exact for perfect compounding (within float tolerance)', () => {
    // 100 * 1.1^2 = 121. Floating point gives 0.10000000000000009, which is
    // why money math is compared with toBeCloseTo, never toBe.
    expect(cagr(100, 121, 2)).toBeCloseTo(0.1, 12);
  });

  it('returns 0 for no growth and -1 for total loss', () => {
    expect(cagr(100, 100, 5)).toBe(0);
    expect(cagr(100, 0, 2)).toBe(-1);
  });

  it('supports fractional years', () => {
    expect(cagr(100, 200, 2.5)).toBeCloseTo(2 ** (1 / 2.5) - 1, 12);
  });

  it('round-trips: start * (1 + cagr)^years === end', () => {
    for (const [start, end, years] of [
      [50, 75, 4],
      [1_000_000, 750_000, 3],
      [3.2, 9.9, 7.5],
    ] as const) {
      expect(start * (1 + cagr(start, end, years)) ** years).toBeCloseTo(end, 6);
    }
  });

  it.each([
    [0, 150, 3, /start must be > 0/],
    [-5, 10, 1, /start must be > 0/],
    [100, -1, 2, /end must be >= 0/],
    [100, 150, 0, /years must be > 0/],
    [100, 150, -2, /years must be > 0/],
    [Number.NaN, 150, 3, /start must be a finite number/],
    [100, Number.POSITIVE_INFINITY, 1, /end must be a finite number/],
  ])('rejects cagr(%s, %s, %s)', (start, end, years, message) => {
    expect(() => cagr(start, end, years)).toThrow(RangeError);
    expect(() => cagr(start, end, years)).toThrow(message);
  });
});
