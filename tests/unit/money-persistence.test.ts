/**
 * Round-trip test for the serialize ↔ DB boundary introduced by the
 * 2026-04-15 Float → Int cents migration. The invariant we prove:
 *
 *   toDollars(fromCents(fromDollars(d).cents)) === roundToCents(d)
 *
 * In other words, stashing a dollar amount to the DB via our helpers and
 * reading it back yields the same dollar value (modulo sub-cent noise
 * that we legitimately round away). Property-tested with fast-check so a
 * regression anywhere in lib/money.ts or lib/serialize.ts will surface
 * as a shrunk counterexample rather than a silent drift.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { fromDollars, fromCents, toDollars } from '../../lib/money';
import {
  projectMoneyFromCents,
  dollarsToCents,
  dollarsToNullableCents,
  serializePayrollEntry,
  serializeReimbursement,
  serializeBlitzCost,
} from '../../lib/serialize';

// Match lib/money's canonicalization: -0 → +0 so the round-trip is
// pointwise equal under Object.is, not just numerically equal.
const roundToCents = (d: number) => {
  const r = Math.round(d * 100) / 100;
  return r === 0 ? 0 : r;
};

describe('money persistence — DB round-trip', () => {
  it('dollars → cents → dollars preserves the value (to the cent)', () => {
    fc.assert(
      fc.property(
        // Realistic commission bounds: ±$10M, 6 decimal precision
        fc.double({ min: -1e7, max: 1e7, noNaN: true, noDefaultInfinity: true }),
        (d) => {
          const cents = fromDollars(d).cents;
          const back = toDollars(fromCents(cents));
          expect(back).toBe(roundToCents(d));
        },
      ),
      { numRuns: 500 },
    );
  });

  it('projectMoneyFromCents maps the 6 fields correctly, preserving nulls', () => {
    const row = {
      m1AmountCents: 189000,
      m2AmountCents: 94500,
      m3AmountCents: null,
      setterM1AmountCents: 0,
      setterM2AmountCents: 37800,
      setterM3AmountCents: 9450,
    };
    const out = projectMoneyFromCents(row);
    expect(out).toEqual({
      m1Amount: 1890,
      m2Amount: 945,
      m3Amount: null,
      setterM1Amount: 0,
      setterM2Amount: 378,
      setterM3Amount: 94.5,
    });
  });

  it('dollarsToCents returns undefined for undefined (preserves "not sent")', () => {
    expect(dollarsToCents(undefined)).toBeUndefined();
    expect(dollarsToCents(null)).toBeUndefined();
    expect(dollarsToCents(0)).toBe(0);
    expect(dollarsToCents(12.34)).toBe(1234);
  });

  it('dollarsToNullableCents distinguishes null from undefined', () => {
    expect(dollarsToNullableCents(undefined)).toBeUndefined();
    expect(dollarsToNullableCents(null)).toBeNull();
    expect(dollarsToNullableCents(0)).toBe(0);
    expect(dollarsToNullableCents(12.34)).toBe(1234);
  });

  it('serializePayrollEntry / Reimbursement / BlitzCost drop *Cents and emit dollars', () => {
    const payroll = serializePayrollEntry({ id: 'p1', amountCents: 150050, status: 'Paid' });
    expect(payroll).toEqual({ id: 'p1', amount: 1500.5, status: 'Paid' });
    // The cents-only key must not leak out.
    expect('amountCents' in payroll).toBe(false);

    const reimb = serializeReimbursement({ id: 'r1', amountCents: 7550, status: 'Pending' });
    expect(reimb).toEqual({ id: 'r1', amount: 75.5, status: 'Pending' });

    const cost = serializeBlitzCost({ id: 'c1', amountCents: 250000, category: 'housing' });
    expect(cost).toEqual({ id: 'c1', amount: 2500, category: 'housing' });
  });

  it('negative amounts round-trip (chargebacks)', () => {
    // Chargebacks store negative payroll amounts — prove the pipeline handles them.
    const cents = fromDollars(-1890.5).cents;
    expect(cents).toBe(-189050);
    expect(toDollars(fromCents(cents))).toBe(-1890.5);
  });
});
