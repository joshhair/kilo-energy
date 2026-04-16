/**
 * Property tests for lib/commission-split.ts. The invariant that matters:
 * an even split across N parties sums EXACTLY back to the original dollar
 * amount (modulo rounding to the cent). No money disappears in a split.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { evenSplit } from '../../lib/commission-split';
import { fromDollars, toDollars, sum, fromCents } from '../../lib/money';

const cents = (d: number) => fromDollars(d).cents;

describe('evenSplit — cent-exact even distribution', () => {
  it('handles zero amount for any party count', () => {
    for (let n = 1; n <= 10; n++) {
      const shares = evenSplit(0, n);
      expect(shares.length).toBe(n);
      for (const s of shares) expect(s).toBe(0);
    }
  });

  it('matches manual division for clean cent-divisible amounts', () => {
    expect(evenSplit(1000, 2)).toEqual([500, 500]);
    expect(evenSplit(1500, 3)).toEqual([500, 500, 500]);
    expect(evenSplit(100, 4)).toEqual([25, 25, 25, 25]);
  });

  it('distributes trailing cents to the earliest indices', () => {
    // $10.01 / 2 = $5.005 — impossible at the cent. Extra cent goes to [0].
    expect(evenSplit(10.01, 2)).toEqual([5.01, 5.00]);
    // $10.02 / 3 = $3.34, $3.34, $3.34 (exact — 1002 cents / 3 = 334)
    expect(evenSplit(10.02, 3)).toEqual([3.34, 3.34, 3.34]);
    // $100 / 3 = 10000 cents / 3 = 3333 remainder 1 → [3334, 3333, 3333]
    expect(evenSplit(100, 3)).toEqual([33.34, 33.33, 33.33]);
  });

  it('round-trip property: split + re-sum equals the rounded original', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 1, max: 10 }),
        (total, n) => {
          const shares = evenSplit(total, n);
          // Sum using integer-cent math to avoid re-introducing float drift.
          const resummed = toDollars(sum(shares.map((s) => fromCents(cents(s)))));
          const expected = toDollars(fromDollars(total));
          expect(resummed).toBe(expected);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('each share is within 1 cent of the average', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 2, max: 10 }),
        (total, n) => {
          const shares = evenSplit(total, n);
          const max = Math.max(...shares);
          const min = Math.min(...shares);
          // At most one cent spread — that's the whole definition of "even".
          expect(Math.abs(cents(max) - cents(min))).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects non-integer / non-positive party counts', () => {
    expect(() => evenSplit(100, 0)).toThrow();
    expect(() => evenSplit(100, -1)).toThrow();
    expect(() => evenSplit(100, 1.5)).toThrow();
  });
});
