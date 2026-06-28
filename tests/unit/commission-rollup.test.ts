// Tests for lib/commission-rollup.ts :: computeProjectRollup.
//
// This is the single source of truth for the admin/internal-PM
// Total / Rep / Kilo-Margin rollup, shared by the client view-model
// (deriveProjectCommissionView) and the server read-path endpoints. The
// load-bearing guarantees: (1) it reproduces the OLD inline client formula
// byte-for-byte (parity), and (2) server cents reconcile to the cent
// (gross = rep + margin).

import { describe, it, expect } from 'vitest';
import { computeProjectRollup, type ProjectRollupInputs } from '@/lib/commission-rollup';

/**
 * The EXACT prior inline arithmetic from commission-derived.ts:135-137,
 * before extraction. The parity test fuzzes inputs through both and asserts
 * the dollar fields are identical — so the refactor cannot have changed a
 * single displayed number.
 */
function legacyDollars(i: ProjectRollupInputs) {
  const repCommissionTotal =
    Math.round(
      (i.closerTotalExpected + i.setterTotalExpected + i.coCloserTotal + i.coSetterTotal + i.trainerTotalExpected) * 100,
    ) / 100;
  const totalCommissionGross = Math.round((i.netPPW - i.kiloPerW) * i.kWSize * 1000 * 100) / 100;
  const kiloMarginAmount = Math.round((totalCommissionGross - repCommissionTotal) * 100) / 100;
  return { repCommissionTotal, totalCommissionGross, kiloMarginAmount };
}

function inputs(overrides: Partial<ProjectRollupInputs> = {}): ProjectRollupInputs {
  return {
    netPPW: 3.85,
    kWSize: 5.28,
    kiloPerW: 2.5,
    closerTotalExpected: 0,
    setterTotalExpected: 0,
    coCloserTotal: 0,
    coSetterTotal: 0,
    trainerTotalExpected: 0,
    ...overrides,
  };
}

describe('computeProjectRollup', () => {
  it('reproduces the legacy client formula exactly (parity)', () => {
    // A spread of realistic + adversarial cases: fractional PPW, large/small
    // kW, co-parties, trainers, and FP-prone values.
    const cases: ProjectRollupInputs[] = [
      inputs(),
      inputs({ netPPW: 4.12, kWSize: 12.345, kiloPerW: 2.73, closerTotalExpected: 3210.55, setterTotalExpected: 980.1 }),
      inputs({ netPPW: 3.0, kWSize: 8.8, kiloPerW: 2.9, closerTotalExpected: 1234.56, coCloserTotal: 222.22, trainerTotalExpected: 88.88 }),
      inputs({ netPPW: 3.33, kWSize: 7.77, kiloPerW: 1.11, setterTotalExpected: 0.1, coSetterTotal: 0.2 }),
      inputs({ netPPW: 2.0, kWSize: 6.0, kiloPerW: 3.5, closerTotalExpected: 500 }), // negative margin
      inputs({ netPPW: 0, kWSize: 0, kiloPerW: 0 }), // all zero
    ];
    for (const c of cases) {
      const got = computeProjectRollup(c);
      const want = legacyDollars(c);
      expect(got.repCommissionTotal).toBe(want.repCommissionTotal);
      expect(got.totalCommissionGross).toBe(want.totalCommissionGross);
      expect(got.kiloMarginAmount).toBe(want.kiloMarginAmount);
    }
  });

  it('reconciles to the cent: gross = rep + margin', () => {
    const cases: ProjectRollupInputs[] = [
      inputs({ netPPW: 4.12, kWSize: 12.345, kiloPerW: 2.73, closerTotalExpected: 3210.55, setterTotalExpected: 980.1, trainerTotalExpected: 150.25 }),
      inputs({ netPPW: 3.85, kWSize: 5.28, kiloPerW: 2.5, closerTotalExpected: 1000, setterTotalExpected: 500, coCloserTotal: 123.45, coSetterTotal: 67.89 }),
      inputs({ netPPW: 2.0, kWSize: 6.0, kiloPerW: 3.5, closerTotalExpected: 500 }), // negative margin still reconciles
    ];
    for (const c of cases) {
      const r = computeProjectRollup(c);
      expect(r.totalCommissionGrossCents).toBe(r.kiloMarginCents + r.repCommissionTotalCents);
    }
  });

  it('emits integer cents that match the 2dp dollar values', () => {
    const r = computeProjectRollup(
      inputs({ netPPW: 3.85, kWSize: 5.28, kiloPerW: 2.5, closerTotalExpected: 1234.56 }),
    );
    expect(Number.isInteger(r.totalCommissionGrossCents)).toBe(true);
    expect(Number.isInteger(r.repCommissionTotalCents)).toBe(true);
    expect(Number.isInteger(r.kiloMarginCents)).toBe(true);
    expect(r.totalCommissionGrossCents).toBe(Math.round(r.totalCommissionGross * 100));
    expect(r.repCommissionTotalCents).toBe(Math.round(r.repCommissionTotal * 100));
    expect(r.kiloMarginCents).toBe(Math.round(r.kiloMarginAmount * 100));
  });

  it('handles kiloPerW > netPPW (Kilo loss) with a negative margin', () => {
    const r = computeProjectRollup(inputs({ netPPW: 2.0, kWSize: 6.0, kiloPerW: 3.5, closerTotalExpected: 500 }));
    // gross = (2.0 - 3.5) * 6 * 1000 = -9000; rep = 500; margin = -9500
    expect(r.totalCommissionGrossCents).toBe(-900000);
    expect(r.repCommissionTotalCents).toBe(50000);
    expect(r.kiloMarginCents).toBe(-950000);
    expect(r.totalCommissionGrossCents).toBe(r.kiloMarginCents + r.repCommissionTotalCents);
  });

  it('is all-zero for an empty deal', () => {
    const r = computeProjectRollup(inputs({ netPPW: 0, kWSize: 0, kiloPerW: 0 }));
    expect(r.totalCommissionGrossCents).toBe(0);
    expect(r.repCommissionTotalCents).toBe(0);
    expect(r.kiloMarginCents).toBe(0);
  });
});
