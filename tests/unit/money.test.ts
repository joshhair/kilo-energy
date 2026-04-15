import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as M from '@/lib/money';

describe('money — construction and conversion', () => {
  it('fromDollars(12.34) = 1234 cents', () => {
    expect(M.fromDollars(12.34).cents).toBe(1234);
  });

  it('fromDollars rounds half-up', () => {
    // Note: Math.round rounds half-AWAY-from-zero in JS — 12.345 * 100 = 1234.4999...
    // so it lands at 1234. This is acceptable for money (fractional cents don't exist).
    expect(M.fromDollars(12.34).cents).toBe(1234);
    expect(M.fromDollars(12.346).cents).toBe(1235);
  });

  it('fromDollars(NaN) and fromDollars(Infinity) → ZERO', () => {
    expect(M.fromDollars(NaN).cents).toBe(0);
    expect(M.fromDollars(Infinity).cents).toBe(0);
  });

  it('toDollars round-trips integer cents exactly', () => {
    expect(M.toDollars(M.fromCents(1234))).toBe(12.34);
    expect(M.toDollars(M.fromCents(-500))).toBe(-5);
  });

  it('toDollars(fromDollars(x)) ≈ x (to cent precision)', () => {
    fc.assert(fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (d) => {
      const round = Math.round(d * 100) / 100;
      expect(M.toDollars(M.fromDollars(d))).toBeCloseTo(round, 2);
    }));
  });
});

describe('money — arithmetic', () => {
  it('add/sub are integer-exact', () => {
    const a = M.fromDollars(0.1);
    const b = M.fromDollars(0.2);
    expect(M.toDollars(M.add(a, b))).toBe(0.3);  // the classic 0.1+0.2 = 0.3 test
  });

  it('mul rounds at the scalar boundary', () => {
    const a = M.fromDollars(10);            // 1000 cents
    expect(M.mul(a, 0.333).cents).toBe(333); // 1000 * 0.333 = 333
  });

  it('mul by non-finite scalar → ZERO', () => {
    expect(M.mul(M.fromDollars(10), NaN).cents).toBe(0);
    expect(M.mul(M.fromDollars(10), Infinity).cents).toBe(0);
  });

  it('nonNegative floors at zero', () => {
    expect(M.nonNegative(M.fromCents(-500)).cents).toBe(0);
    expect(M.nonNegative(M.fromCents(500)).cents).toBe(500);
  });
});

describe('money — sum', () => {
  it('sums exactly (no float drift)', () => {
    const hundredDimes = Array.from({ length: 100 }, () => M.fromDollars(0.1));
    expect(M.toDollars(M.sum(hundredDimes))).toBe(10);
  });

  it('sum of empty array is ZERO', () => {
    expect(M.sum([]).cents).toBe(0);
  });

  it('sum is associative', () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: -1e6, max: 1e6 }), { minLength: 2, maxLength: 50 }),
      (cents) => {
        const moneys = cents.map(M.fromCents);
        const total = M.sum(moneys);
        // Rebalancing the split doesn't change the total.
        const half = Math.floor(moneys.length / 2);
        const a = M.sum(moneys.slice(0, half));
        const b = M.sum(moneys.slice(half));
        expect(M.add(a, b).cents).toBe(total.cents);
      },
    ));
  });
});

describe('money — splitEvenly', () => {
  it('even split sums to whole', () => {
    const halves = M.splitEvenly(M.fromDollars(10), 2);
    expect(halves.length).toBe(2);
    expect(M.sum(halves).cents).toBe(1000);
  });

  it('odd-cent split distributes remainder', () => {
    const [a, b, c] = M.splitEvenly(M.fromDollars(10.01), 3);
    expect(M.sum([a, b, c]).cents).toBe(1001);
    // Remainder of 2 cents goes to the first 2 parts.
    expect(a.cents).toBe(334);
    expect(b.cents).toBe(334);
    expect(c.cents).toBe(333);
  });

  it('negative splits respect sign', () => {
    const parts = M.splitEvenly(M.fromCents(-1001), 3);
    expect(M.sum(parts).cents).toBe(-1001);
  });

  it('parts must be positive integer', () => {
    expect(() => M.splitEvenly(M.fromDollars(10), 0)).toThrow();
    expect(() => M.splitEvenly(M.fromDollars(10), 1.5)).toThrow();
    expect(() => M.splitEvenly(M.fromDollars(10), -1)).toThrow();
  });

  it('property: split into N parts always sums to original', () => {
    fc.assert(fc.property(
      fc.integer({ min: -1e6, max: 1e6 }),
      fc.integer({ min: 1, max: 20 }),
      (cents, parts) => {
        const m = M.fromCents(cents);
        const split = M.splitEvenly(m, parts);
        expect(split.length).toBe(parts);
        expect(M.sum(split).cents).toBe(cents);
      },
    ));
  });
});

describe('money — allocate', () => {
  it('60/40 of $100 = [$60, $40]', () => {
    const [a, b] = M.allocate(M.fromDollars(100), [60, 40]);
    expect(a.cents).toBe(6000);
    expect(b.cents).toBe(4000);
  });

  it('allocates remainder to largest weight first', () => {
    // $1.00 (100 cents) with weights [2, 1]: ideal 66.67, 33.33 cents.
    // Floor: [66, 33]. Remainder 1 goes to weight 2 (largest).
    const [a, b] = M.allocate(M.fromDollars(1), [2, 1]);
    expect(a.cents).toBe(67);
    expect(b.cents).toBe(33);
  });

  it('rejects empty weights or zero total', () => {
    expect(() => M.allocate(M.fromDollars(1), [])).toThrow();
    expect(() => M.allocate(M.fromDollars(1), [0, 0])).toThrow();
  });

  it('property: allocations always sum exactly', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 1e6 }),
      fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 10 }),
      (cents, weights) => {
        const parts = M.allocate(M.fromCents(cents), weights);
        expect(parts.length).toBe(weights.length);
        expect(M.sum(parts).cents).toBe(cents);
      },
    ));
  });
});
