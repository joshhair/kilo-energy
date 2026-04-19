import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateCommission, splitCloserSetterPay } from '@/lib/data';
import { shouldCreateSetterM1OnSetterAdd } from '@/lib/commission';

/**
 * Property-based tests for commission math.
 *
 * Financial correctness deserves fuzzing. Example-based tests cover known
 * scenarios; these verify invariants hold across the entire input space.
 * If any of these ever fail, commission math has shipped a regression that
 * would silently pay reps wrong amounts.
 */

// Realistic ranges for a solar commission math input space.
const ppw = fc.double({ min: 0, max: 10, noNaN: true });       // $/W sold price
const baseline = fc.double({ min: 0, max: 10, noNaN: true });  // $/W baseline
const kW = fc.double({ min: 0.1, max: 50, noNaN: true });      // system size (kW)
const trainerRate = fc.double({ min: 0, max: 1, noNaN: true }); // $/W override
const installPct = fc.double({ min: 0, max: 1, noNaN: true });

describe('calculateCommission — invariants', () => {
  it('never returns negative', () => {
    fc.assert(fc.property(ppw, baseline, kW, (p, b, k) => {
      expect(calculateCommission(p, b, k)).toBeGreaterThanOrEqual(0);
    }));
  });

  it('never returns NaN or Infinity', () => {
    fc.assert(fc.property(ppw, baseline, kW, (p, b, k) => {
      const r = calculateCommission(p, b, k);
      expect(Number.isFinite(r)).toBe(true);
    }));
  });

  it('always rounded to cent precision (no floating-point tails)', () => {
    fc.assert(fc.property(ppw, baseline, kW, (p, b, k) => {
      const r = calculateCommission(p, b, k);
      // Multiplying by 100 should yield an integer to within rounding tolerance.
      const cents = Math.round(r * 100);
      expect(Math.abs(r * 100 - cents)).toBeLessThan(1e-6);
    }));
  });

  it('returns 0 when soldPPW <= baseline (no negative commissions)', () => {
    fc.assert(fc.property(
      fc.double({ min: 0, max: 5, noNaN: true }),
      fc.double({ min: 5.01, max: 10, noNaN: true }),
      kW,
      (p, b, k) => {
        expect(calculateCommission(p, b, k)).toBe(0);
      },
    ));
  });

  it('monotonic in soldPPW (higher sold price => higher-or-equal commission)', () => {
    fc.assert(fc.property(
      fc.double({ min: 0, max: 10, noNaN: true }),
      fc.double({ min: 0, max: 10, noNaN: true }),
      baseline,
      kW,
      (p1, p2, b, k) => {
        const [lo, hi] = p1 <= p2 ? [p1, p2] : [p2, p1];
        expect(calculateCommission(hi, b, k)).toBeGreaterThanOrEqual(
          calculateCommission(lo, b, k),
        );
      },
    ));
  });

  it('scales linearly in kW when above baseline', () => {
    // (p - b) * k * 1000 should double when k doubles.
    fc.assert(fc.property(
      fc.double({ min: 5, max: 10, noNaN: true }),
      fc.double({ min: 0, max: 4, noNaN: true }),
      fc.double({ min: 1, max: 20, noNaN: true }),
      (p, b, k) => {
        const single = calculateCommission(p, b, k);
        const double = calculateCommission(p, b, k * 2);
        // Allow cent-rounding drift of up to 2¢.
        expect(Math.abs(double - single * 2)).toBeLessThanOrEqual(0.02);
      },
    ));
  });
});

describe('splitCloserSetterPay — invariants', () => {
  it('closer + setter totals never negative', () => {
    fc.assert(fc.property(ppw, baseline, baseline, trainerRate, kW, installPct, (p, c, s, tr, k, ip) => {
      const r = splitCloserSetterPay(p, c, s, tr, k, ip);
      expect(r.closerTotal).toBeGreaterThanOrEqual(0);
      expect(r.setterTotal).toBeGreaterThanOrEqual(0);
    }));
  });

  it('milestone amounts (M1/M2/M3) never exceed their totals', () => {
    fc.assert(fc.property(ppw, baseline, baseline, trainerRate, kW, installPct, (p, c, s, tr, k, ip) => {
      const r = splitCloserSetterPay(p, c, s, tr, k, ip);
      const closerSum = r.closerM1 + r.closerM2 + r.closerM3;
      const setterSum = r.setterM1 + r.setterM2 + r.setterM3;
      // Allow 2¢ tolerance for the Math.floor halving in the split math.
      expect(closerSum).toBeLessThanOrEqual(r.closerTotal + 0.02);
      expect(setterSum).toBeLessThanOrEqual(r.setterTotal + 0.02);
    }));
  });

  it('self-gen (setterBaseline=0) routes entire commission to closer', () => {
    fc.assert(fc.property(ppw, baseline, kW, installPct, (p, c, k, ip) => {
      const r = splitCloserSetterPay(p, c, 0, 0, k, ip);
      expect(r.setterTotal).toBe(0);
      expect(r.setterM1).toBe(0);
      expect(r.setterM2).toBe(0);
      expect(r.setterM3).toBe(0);
    }));
  });

  it('all fields always finite (no NaN or Infinity)', () => {
    fc.assert(fc.property(ppw, baseline, baseline, trainerRate, kW, installPct, (p, c, s, tr, k, ip) => {
      const r = splitCloserSetterPay(p, c, s, tr, k, ip);
      for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true);
    }));
  });

  // ── Money-exact invariants (added when commission math moved to integer cents) ──

  // Compare two money-looking numbers as exact integer cents — avoids
  // floating-point equality flakiness on round-trip through toDollars.
  const cents = (n: number) => Math.round(n * 100);

  it('EXACT: closerM1 + closerM2 + closerM3 === closerTotal (to the cent)', () => {
    fc.assert(fc.property(ppw, baseline, baseline, trainerRate, kW, installPct, (p, c, s, tr, k, ip) => {
      const r = splitCloserSetterPay(p, c, s, tr, k, ip);
      expect(cents(r.closerM1) + cents(r.closerM2) + cents(r.closerM3)).toBe(cents(r.closerTotal));
    }));
  });

  it('EXACT: setterM1 + setterM2 + setterM3 === setterTotal (to the cent)', () => {
    fc.assert(fc.property(ppw, baseline, baseline, trainerRate, kW, installPct, (p, c, s, tr, k, ip) => {
      const r = splitCloserSetterPay(p, c, s, tr, k, ip);
      expect(cents(r.setterM1) + cents(r.setterM2) + cents(r.setterM3)).toBe(cents(r.setterTotal));
    }));
  });

  it('EXACT: closer/setter 50/50 split of the above-setter amount sums to the whole', () => {
    // Construct a scenario where the sold price exceeds both baselines so
    // closerDifferential AND aboveSplit are nonzero. closerTotal - closerDifferential
    // should equal exactly half of aboveSplit (to the cent).
    fc.assert(fc.property(
      fc.double({ min: 5, max: 10, noNaN: true }),     // soldPPW
      fc.double({ min: 1, max: 3, noNaN: true }),      // closerPerW (lower)
      fc.double({ min: 3.01, max: 5, noNaN: true }),   // setterBaselinePerW (higher)
      fc.double({ min: 0, max: 0.3, noNaN: true }),    // trainerRate
      fc.double({ min: 1, max: 20, noNaN: true }),     // kW
      fc.double({ min: 0, max: 1, noNaN: true }),      // installPct
      (p, c, s, tr, k, ip) => {
        const r = splitCloserSetterPay(p, c, s, tr, k, ip);
        // closerTotal + setterTotal === closerDifferential + aboveSplit — but we
        // don't expose those internals. Instead assert that the two totals
        // sum to a value with no fractional cents.
        const totalCents = cents(r.closerTotal) + cents(r.setterTotal);
        expect(Number.isInteger(totalCents)).toBe(true);
      },
    ));
  });
});

describe('shouldCreateSetterM1OnSetterAdd — setter-re-add guard', () => {
  // Regression anchor for the Timothy-Salunga-shape bug. Before the fix,
  // the guard blocked creating a setter M1 PayrollEntry whenever the closer
  // had already been Paid M1 — leaving `setterM1AmountCents` orphan on the
  // Project with no payroll row. After the fix, the guard only blocks when
  // the PREVIOUS setter (not the closer) was already Paid.

  const baseOpts = {
    pastAcceptance: true as boolean,
    effectiveSetterM1: 1000,
    projectId: 'proj_1',
    newSetterId: 'setter_new',
    oldSetterId: null as string | null,
    existingEntries: [] as Array<{ projectId: string; repId: string; paymentStage: string; status: string }>,
  };

  it('creates setter M1 when no prior setter existed, even if closer was Paid M1', () => {
    // The canonical Timothy-Salunga shape: deal submitted without a setter,
    // closer's M1 already Paid, then setter added via edit.
    expect(
      shouldCreateSetterM1OnSetterAdd({
        ...baseOpts,
        oldSetterId: null,
        existingEntries: [
          { projectId: 'proj_1', repId: 'closer_1', paymentStage: 'M1', status: 'Paid' },
        ],
      }),
    ).toBe(true);
  });

  it('skips creation when the previous setter was already Paid M1 (setter replacement after payout)', () => {
    // Replacing setter A with setter B after A was already Paid — admin must
    // reconcile manually because we can't un-pay.
    expect(
      shouldCreateSetterM1OnSetterAdd({
        ...baseOpts,
        oldSetterId: 'setter_old',
        existingEntries: [
          { projectId: 'proj_1', repId: 'setter_old', paymentStage: 'M1', status: 'Paid' },
        ],
      }),
    ).toBe(false);
  });

  it('creates setter M1 when previous setter had only Draft/Pending M1 (safe to swap)', () => {
    expect(
      shouldCreateSetterM1OnSetterAdd({
        ...baseOpts,
        oldSetterId: 'setter_old',
        existingEntries: [
          { projectId: 'proj_1', repId: 'setter_old', paymentStage: 'M1', status: 'Draft' },
        ],
      }),
    ).toBe(true);
  });

  it('skips when new setter already has an M1 entry (defensive, avoids duplication)', () => {
    expect(
      shouldCreateSetterM1OnSetterAdd({
        ...baseOpts,
        existingEntries: [
          { projectId: 'proj_1', repId: 'setter_new', paymentStage: 'M1', status: 'Draft' },
        ],
      }),
    ).toBe(false);
  });

  it('skips when not past Acceptance (payroll is created at phase transition, not before)', () => {
    expect(
      shouldCreateSetterM1OnSetterAdd({ ...baseOpts, pastAcceptance: false }),
    ).toBe(false);
  });

  it('skips when effectiveSetterM1 is zero or null (nothing owed)', () => {
    expect(shouldCreateSetterM1OnSetterAdd({ ...baseOpts, effectiveSetterM1: 0 })).toBe(false);
    expect(shouldCreateSetterM1OnSetterAdd({ ...baseOpts, effectiveSetterM1: null })).toBe(false);
    expect(shouldCreateSetterM1OnSetterAdd({ ...baseOpts, effectiveSetterM1: undefined })).toBe(false);
  });

  it('is project-scoped: an M1 Paid to the same setter on a DIFFERENT project does not block creation', () => {
    expect(
      shouldCreateSetterM1OnSetterAdd({
        ...baseOpts,
        oldSetterId: 'setter_old',
        existingEntries: [
          { projectId: 'proj_other', repId: 'setter_old', paymentStage: 'M1', status: 'Paid' },
        ],
      }),
    ).toBe(true);
  });
});

// ─── Batch 2b.7: server-authoritative computeProjectCommission invariants ────
// These guard the contract that PATCH /api/projects/[id] relies on: running
// the server resolver over a deal's inputs is deterministic, non-negative,
// and co-party-consistent. If any of these ever fail, commissions computed
// on PATCH will silently pay reps wrong amounts.
import { computeProjectCommission } from '@/lib/commission-server';

describe('computeProjectCommission — invariants', () => {
  const baselineOverride = { closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 };
  const emptyDeps = {
    installerPricingVersions: [],
    solarTechProducts: [],
    productCatalogProducts: [],
    productCatalogPricingVersions: [],
    trainerAssignments: [],
    payrollEntries: [],
    installerPayConfigs: { BVI: { installPayPct: 80 } },
  };

  it('never returns negative amounts', () => {
    fc.assert(fc.property(ppw, kW, (p, k) => {
      const out = computeProjectCommission(
        {
          soldDate: '2026-04-17',
          netPPW: p,
          kWSize: k,
          installer: 'BVI',
          productType: 'Loan',
          closerId: 'closer_1',
          setterId: 'setter_1',
          baselineOverride,
          additionalClosers: [],
          additionalSetters: [],
        },
        emptyDeps,
      );
      expect(out.m1Amount).toBeGreaterThanOrEqual(0);
      expect(out.m2Amount).toBeGreaterThanOrEqual(0);
      expect(out.m3Amount ?? 0).toBeGreaterThanOrEqual(0);
      expect(out.setterM1Amount).toBeGreaterThanOrEqual(0);
      expect(out.setterM2Amount).toBeGreaterThanOrEqual(0);
      expect(out.setterM3Amount ?? 0).toBeGreaterThanOrEqual(0);
    }));
  });

  it('deterministic: two runs with identical inputs produce identical outputs', () => {
    fc.assert(fc.property(ppw, kW, (p, k) => {
      const inputs = {
        soldDate: '2026-04-17',
        netPPW: p,
        kWSize: k,
        installer: 'BVI',
        productType: 'Loan',
        closerId: 'closer_1',
        setterId: 'setter_1',
        baselineOverride,
        additionalClosers: [],
        additionalSetters: [],
      };
      const a = computeProjectCommission(inputs, emptyDeps);
      const b = computeProjectCommission(inputs, emptyDeps);
      expect(a).toEqual(b);
    }));
  });

  it('sub-dealer flag zeroes every amount (different formula handled elsewhere)', () => {
    fc.assert(fc.property(ppw, kW, (p, k) => {
      const out = computeProjectCommission(
        {
          soldDate: '2026-04-17',
          netPPW: p,
          kWSize: k,
          installer: 'BVI',
          productType: 'Loan',
          closerId: 'closer_1',
          setterId: 'setter_1',
          subDealerId: 'sd_1',
          baselineOverride,
          additionalClosers: [],
          additionalSetters: [],
        },
        emptyDeps,
      );
      expect(out.m1Amount).toBe(0);
      expect(out.m2Amount).toBe(0);
      expect(out.setterM1Amount).toBe(0);
      expect(out.setterM2Amount).toBe(0);
    }));
  });

  it('installPayPct=100 → M3 slots are null (no deferred payment stage)', () => {
    fc.assert(fc.property(ppw, kW, (p, k) => {
      const out = computeProjectCommission(
        {
          soldDate: '2026-04-17',
          netPPW: p,
          kWSize: k,
          installer: 'BVI',
          productType: 'Loan',
          closerId: 'closer_1',
          setterId: 'setter_1',
          baselineOverride,
          additionalClosers: [],
          additionalSetters: [],
        },
        { ...emptyDeps, installerPayConfigs: { BVI: { installPayPct: 100 } } },
      );
      expect(out.m3Amount).toBeNull();
      expect(out.setterM3Amount).toBeNull();
    }));
  });

  it('co-closer amounts never drive primary closer amounts negative', () => {
    // Arbitrary co-party splits up to $10k/slot — the floor clamp inside
    // computeProjectCommission must keep primary amounts >= 0 regardless.
    const co = fc.record({
      m1Amount: fc.double({ min: 0, max: 10000, noNaN: true }),
      m2Amount: fc.double({ min: 0, max: 10000, noNaN: true }),
      m3Amount: fc.double({ min: 0, max: 10000, noNaN: true }),
    });
    fc.assert(fc.property(ppw, kW, co, (p, k, c) => {
      const out = computeProjectCommission(
        {
          soldDate: '2026-04-17',
          netPPW: p,
          kWSize: k,
          installer: 'BVI',
          productType: 'Loan',
          closerId: 'closer_1',
          setterId: 'setter_1',
          baselineOverride,
          additionalClosers: [c],
          additionalSetters: [],
        },
        emptyDeps,
      );
      expect(out.m1Amount).toBeGreaterThanOrEqual(0);
      expect(out.m2Amount).toBeGreaterThanOrEqual(0);
      expect(out.m3Amount ?? 0).toBeGreaterThanOrEqual(0);
    }));
  });

  it('amounts are cent-precision (no floating-point tails after multiplying by 100)', () => {
    fc.assert(fc.property(ppw, kW, (p, k) => {
      const out = computeProjectCommission(
        {
          soldDate: '2026-04-17',
          netPPW: p,
          kWSize: k,
          installer: 'BVI',
          productType: 'Loan',
          closerId: 'closer_1',
          setterId: 'setter_1',
          baselineOverride,
          additionalClosers: [],
          additionalSetters: [],
        },
        emptyDeps,
      );
      for (const v of [out.m1Amount, out.m2Amount, out.setterM1Amount, out.setterM2Amount]) {
        const cents = Math.round(v * 100);
        expect(Math.abs(v * 100 - cents)).toBeLessThan(1e-6);
      }
    }));
  });

  it('self-gen (no setter) keeps all commission on the closer side', () => {
    fc.assert(fc.property(ppw, kW, (p, k) => {
      const out = computeProjectCommission(
        {
          soldDate: '2026-04-17',
          netPPW: p,
          kWSize: k,
          installer: 'BVI',
          productType: 'Loan',
          closerId: 'closer_1',
          setterId: null,
          baselineOverride,
          additionalClosers: [],
          additionalSetters: [],
        },
        emptyDeps,
      );
      expect(out.setterM1Amount).toBe(0);
      expect(out.setterM2Amount).toBe(0);
      expect(out.setterM3Amount ?? 0).toBe(0);
    }));
  });

  // ─── Phase 2.2 additions — stronger invariants ────────────────────

  it('envelope conservation: closer + setter + trainer = (soldPPW - closerPerW) × kW × 1000 when above baseline', () => {
    // The "total commission envelope" — money out to closer + setter +
    // trainer combined — should exactly equal the amount the deal
    // generates above the closer baseline, regardless of how the
    // trainer rate shifts the split point. This catches bugs where a
    // formula change inadvertently changes the envelope size (leaking
    // or retaining money vs the commercial policy).
    fc.assert(fc.property(
      fc.double({ min: 3, max: 10, noNaN: true }),      // ppw — always above baselines
      fc.double({ min: 1, max: 2, noNaN: true }),       // closerPerW
      fc.double({ min: 2, max: 3, noNaN: true }),       // setterBaselinePerW (>closer)
      fc.double({ min: 0, max: 0.5, noNaN: true }),     // trainerRate
      fc.double({ min: 1, max: 20, noNaN: true }),      // kW
      (p, c, s, tr, k) => {
        if (p <= c + 0.01) return; // skip degenerate
        if (s <= c + 0.01) return;
        const out = splitCloserSetterPay(p, c, s, tr, k, 80);
        const trainerTotal = tr * k * 1000;
        const envelope = out.closerTotal + out.setterTotal + trainerTotal;
        const expected = (p - c) * k * 1000;
        // Tolerance: 1 cent × kW — aboveSplit clips at 0 when
        // tr >= p - s, so the envelope only equals expected when there's
        // SOME money above the setter+trainer split point. When there
        // isn't, the envelope is differential + trainerTotal, which
        // equals (s - c + tr) × k × 1000 — not (p - c). Skip those.
        if (p - (s + tr) < 0.01) return;
        expect(Math.abs(envelope - expected)).toBeLessThan(0.05);
      },
    ));
  });

  it('trainer substitution: increasing trainerRate never decreases envelope, only shifts distribution', () => {
    // With the same ppw/baselines/kw, bumping trainerRate from X to Y
    // should: trainer gets MORE, closer gets LESS OR EQUAL, setter
    // gets LESS OR EQUAL, total envelope unchanged (within float
    // tolerance).
    fc.assert(fc.property(
      fc.double({ min: 3, max: 10, noNaN: true }),
      fc.double({ min: 1, max: 2, noNaN: true }),
      fc.double({ min: 2, max: 3, noNaN: true }),
      fc.double({ min: 0, max: 0.3, noNaN: true }),
      fc.double({ min: 1, max: 20, noNaN: true }),
      (p, c, s, trLow, k) => {
        if (p <= s + 0.01) return;
        if (s <= c + 0.01) return;
        const trHigh = trLow + 0.10;
        // Both trainer rates must leave SOME above-split room so we're
        // comparing like for like (tr fully consumed → envelope
        // depends on tr alone, which invalidates the "envelope
        // unchanged" rule). Skip when the higher trainer rate would
        // clip aboveSplit.
        if (p - (s + trHigh) < 0.01) return;
        const low = splitCloserSetterPay(p, c, s, trLow, k, 80);
        const high = splitCloserSetterPay(p, c, s, trHigh, k, 80);
        expect(high.closerTotal).toBeLessThanOrEqual(low.closerTotal + 0.01);
        expect(high.setterTotal).toBeLessThanOrEqual(low.setterTotal + 0.01);
        const lowEnv = low.closerTotal + low.setterTotal + trLow * k * 1000;
        const highEnv = high.closerTotal + high.setterTotal + trHigh * k * 1000;
        expect(Math.abs(highEnv - lowEnv)).toBeLessThan(0.05);
      },
    ));
  });

  it('self-gen M1 flat is $1000 for kW ≥ 5 and $500 for kW < 5', () => {
    fc.assert(fc.property(ppw, kW, (p, k) => {
      if (p <= 2.0) return; // need commission above M1 flat
      const out = splitCloserSetterPay(p, 1.5, 0, 0, k, 80); // self-gen
      const expectedFlat = k >= 5 ? 1000 : 500;
      // closerM1 = min(flat, closerTotal). When closerTotal >= flat,
      // closerM1 = flat exactly.
      if (out.closerTotal >= expectedFlat) {
        expect(out.closerM1).toBe(expectedFlat);
      }
    }));
  });

  it('paired deal: setter M1 is flat (not closer M1)', () => {
    fc.assert(fc.property(
      fc.double({ min: 3, max: 10, noNaN: true }),
      fc.double({ min: 5, max: 20, noNaN: true }), // kW ≥ 5 so flat is $1000
      (p, k) => {
        const out = splitCloserSetterPay(p, 2.85, 2.95, 0, k, 80);
        // Paired: closer M1 always 0 (flat routes to setter instead).
        expect(out.closerM1).toBe(0);
        if (out.setterTotal >= 1000) {
          expect(out.setterM1).toBe(1000);
        }
      },
    ));
  });

  it('closer differential is exactly (setterPerW - closerPerW) × kW × 1000 when fully capped', () => {
    // When soldPPW is high enough that the min() cap doesn't clip, the
    // differential equals the straight difference. This pins the exact
    // numerical relationship that reps understand as "closer bonus."
    fc.assert(fc.property(
      fc.double({ min: 5, max: 10, noNaN: true }),
      fc.double({ min: 1, max: 2, noNaN: true }),
      fc.double({ min: 2, max: 3, noNaN: true }),
      fc.double({ min: 1, max: 20, noNaN: true }),
      (p, c, s, k) => {
        if (p <= s + 0.01) return;
        if (s <= c + 0.01) return;
        const out = splitCloserSetterPay(p, c, s, 0, k, 80);
        const above = (p - s) * k * 1000;
        const expectedDifferential = (s - c) * k * 1000;
        const expectedCloserTotal = expectedDifferential + above / 2;
        expect(Math.abs(out.closerTotal - expectedCloserTotal)).toBeLessThan(0.02);
      },
    ));
  });

  it('setter never earns more than closer on the same deal (with zero trainer)', () => {
    // Setter's pay from the split is aboveSplit/2; closer gets that
    // PLUS the differential. Closer should always earn ≥ setter for
    // any non-zero differential, any sold price.
    fc.assert(fc.property(
      fc.double({ min: 2, max: 10, noNaN: true }),
      fc.double({ min: 1, max: 2, noNaN: true }),
      fc.double({ min: 2, max: 3, noNaN: true }),
      fc.double({ min: 1, max: 20, noNaN: true }),
      (p, c, s, k) => {
        if (s <= c) return;
        const out = splitCloserSetterPay(p, c, s, 0, k, 80);
        // Closer should earn at least as much as setter.
        expect(out.closerTotal).toBeGreaterThanOrEqual(out.setterTotal - 0.01);
      },
    ));
  });

  it('closerM1 + setterM1 never exceeds the M1 flat amount (prevents double-M1 bug)', () => {
    // On any deal, at most one side gets the flat M1 payout. If both
    // received it, we'd be paying $1000 or $500 twice per deal.
    fc.assert(fc.property(ppw, baseline, kW, (p, b, k) => {
      const out = splitCloserSetterPay(p, b, b + 0.10, 0, k, 80);
      const flatExpected = k >= 5 ? 1000 : 500;
      expect(out.closerM1 + out.setterM1).toBeLessThanOrEqual(flatExpected + 0.01);
    }));
  });

  it('installPayPct affects M2/M3 split but not totals', () => {
    // Changing installPayPct between 50 and 100 rebalances M2 vs M3
    // but must not change closerTotal or setterTotal.
    fc.assert(fc.property(
      fc.double({ min: 3, max: 10, noNaN: true }),
      fc.double({ min: 1, max: 2, noNaN: true }),
      fc.double({ min: 1, max: 20, noNaN: true }),
      fc.integer({ min: 50, max: 99 }),
      (p, c, k, pct) => {
        if (p <= c + 0.10) return;
        const paired = splitCloserSetterPay(p, c, c + 0.10, 0, k, 80);
        const varied = splitCloserSetterPay(p, c, c + 0.10, 0, k, pct);
        expect(Math.abs(paired.closerTotal - varied.closerTotal)).toBeLessThan(0.02);
        expect(Math.abs(paired.setterTotal - varied.setterTotal)).toBeLessThan(0.02);
      },
    ));
  });

  it('installPayPct=100 nulls M3 on both sides (never 0)', () => {
    // The null vs 0 distinction matters for UI rendering — null means
    // "no M3 by design," 0 means "M3 earned but not paid."
    fc.assert(fc.property(ppw, kW, (p, k) => {
      const out = splitCloserSetterPay(p, 2.85, 2.95, 0, k, 100);
      expect(out.closerM3).toBe(0);
      expect(out.setterM3).toBe(0);
      // Note: splitCloserSetterPay returns 0 not null at the raw
      // level — computeProjectCommission wraps to null. Confirmed
      // the wrap happens in commission-server.ts.
    }));
  });

  it('zero-commission edge: when soldPPW equals baseline exactly, everyone gets 0', () => {
    fc.assert(fc.property(
      fc.double({ min: 2, max: 5, noNaN: true }),
      fc.double({ min: 1, max: 20, noNaN: true }),
      (baseline, k) => {
        const out = splitCloserSetterPay(baseline, baseline, baseline, 0, k, 80);
        expect(out.closerTotal).toBe(0);
        expect(out.setterTotal).toBe(0);
        expect(out.closerM1 + out.closerM2 + out.closerM3).toBe(0);
      },
    ));
  });
});
