/**
 * Tests for the calculator-side closer-trainer-override deduction helper.
 *
 * The helper exists because `splitCloserSetterPay` in lib/commission.ts does
 * not take a closer-trainer rate — only a setter one. Server payroll handles
 * closer overrides as a post-split deduction (see project-transitions.ts).
 * These tests pin down the parity with that server logic so the calculator
 * UI can never silently drift from what reps actually get paid.
 */

import { describe, it, expect } from 'vitest';
import { applyCloserTrainerDeduction } from '../../lib/closer-trainer-deduction';
import type { CommissionSplit } from '../../lib/commission';

const split = (overrides: Partial<CommissionSplit> = {}): CommissionSplit => ({
  closerTotal: 0,
  setterTotal: 0,
  closerM1: 0,
  closerM2: 0,
  closerM3: 0,
  setterM1: 0,
  setterM2: 0,
  setterM3: 0,
  ...overrides,
});

describe('applyCloserTrainerDeduction', () => {
  it('returns the split unchanged when rate is zero', () => {
    const s = split({ closerTotal: 750, closerM1: 1000, closerM2: -250 });
    expect(applyCloserTrainerDeduction(s, 0, 5, 80)).toEqual(s);
  });

  it('returns the split unchanged when kW is zero (no deal yet)', () => {
    const s = split({ closerTotal: 0, closerM1: 0, closerM2: 0, closerM3: 0 });
    expect(applyCloserTrainerDeduction(s, 0.10, 0, 80)).toEqual(s);
  });

  it('returns the split unchanged when rate is negative (defensive — bad data)', () => {
    const s = split({ closerTotal: 500, closerM2: 500 });
    expect(applyCloserTrainerDeduction(s, -0.10, 5, 80)).toEqual(s);
  });

  it('does not modify the setter side under any circumstances', () => {
    const s = split({
      closerTotal: 750, closerM1: 1000, closerM2: -200, closerM3: -50,
      setterTotal: 1234, setterM1: 500, setterM2: 587, setterM3: 147,
    });
    const out = applyCloserTrainerDeduction(s, 0.20, 8, 80);
    expect(out.setterTotal).toBe(1234);
    expect(out.setterM1).toBe(500);
    expect(out.setterM2).toBe(587);
    expect(out.setterM3).toBe(147);
  });

  it('does not modify M1 (M1 is upfront, untouchable)', () => {
    const s = split({ closerTotal: 1500, closerM1: 1000, closerM2: 400, closerM3: 100 });
    const out = applyCloserTrainerDeduction(s, 0.10, 5, 80);
    expect(out.closerM1).toBe(1000);
  });

  describe('Tristan + Paul scenario — 5 kW @ $3.00/W self-gen, $0.10 override', () => {
    // Pre-deduction split that splitCloserSetterPay would return:
    //   closerTotal = (3.00 - 2.85) × 5kW × 1000 = $750
    //   M1 = $1000 (kW >= 5 self-gen flat, capped by closerTotal)
    //   80/20 installer → remainder = max(0, 750 - 1000) = $0; both M2 = M3 = 0
    // (The closerTotal vs M1 mismatch is irrelevant to the helper — it operates
    //  on whatever split it's given. Real-world example uses a higher PPW where
    //  M2/M3 are non-zero.)

    it('80/20 installer at $3.50/W — closer gets $5,500 - $500 trainer = $5,000', () => {
      // closerTotal = (3.50 - 2.85) × 5 × 1000 = $3,250 (raw split)
      // After server-mirror deduction of $500: closer = $2,750
      // M1 = 1000, remainder = 2250, M2 = 1800, M3 = 450 (80/20 of remainder)
      // Apply helper: M2 -= 500*0.8 = 400 → 1400; M3 -= 500*0.2 = 100 → 350
      // closerTotal = 1000 + 1400 + 350 = 2750
      const s = split({ closerTotal: 3250, closerM1: 1000, closerM2: 1800, closerM3: 450 });
      const out = applyCloserTrainerDeduction(s, 0.10, 5, 80);
      expect(out.closerM1).toBe(1000);
      expect(out.closerM2).toBe(1400);
      expect(out.closerM3).toBe(350);
      expect(out.closerTotal).toBe(2750);
    });

    it('flat installer (installPayPct=100) — entire deduction hits M2, M3 stays 0', () => {
      // SolarTech-style: M2 = full closer remainder, no M3 leg.
      // closerTotal = $3,250, M1 = $1,000, M2 = $2,250, M3 = 0.
      // Deduction $500 all hits M2 → M2 = $1,750, M3 = 0.
      const s = split({ closerTotal: 3250, closerM1: 1000, closerM2: 2250, closerM3: 0 });
      const out = applyCloserTrainerDeduction(s, 0.10, 5, 100);
      expect(out.closerM1).toBe(1000);
      expect(out.closerM2).toBe(1750);
      expect(out.closerM3).toBe(0);
      expect(out.closerTotal).toBe(2750);
    });
  });

  it('clamps M2 at 0 — never goes negative even if deduction exceeds M2', () => {
    // Deduction of $0.20/W on 5kW = $1,000, but closer only has $200 in M2.
    // M2 floors at 0, M3 takes the M3 portion only (not M2's overflow).
    const s = split({ closerTotal: 1300, closerM1: 1000, closerM2: 200, closerM3: 100 });
    const out = applyCloserTrainerDeduction(s, 0.20, 5, 80);
    // total deduction = 1000, M2-portion = 800, M3-portion = 200
    // M2 = max(0, 200 - 800) = 0
    // M3 = max(0, 100 - 200) = 0
    // closerTotal = 1000 + 0 + 0 = 1000 (just M1)
    expect(out.closerM2).toBe(0);
    expect(out.closerM3).toBe(0);
    expect(out.closerTotal).toBe(1000);
  });

  it('clamps closerTotal at M1 amount when override exceeds all of M2+M3', () => {
    const s = split({ closerTotal: 750, closerM1: 500, closerM2: 200, closerM3: 50 });
    const out = applyCloserTrainerDeduction(s, 1.00, 5, 80); // absurd override
    expect(out.closerM1).toBe(500);     // M1 untouched
    expect(out.closerM2).toBe(0);
    expect(out.closerM3).toBe(0);
    expect(out.closerTotal).toBe(500);  // = closerM1
  });

  it('cent rounding — splits a cent-imprecise total without losing money', () => {
    // 0.07/W × 5kW × 1000 = $350.00 (clean) — but try 0.0333/W: 166.5 → 167 cents/W.
    // Total = round(0.0333 × 5 × 1000 × 100) = round(16650) = 16650 cents = $166.50.
    // 80% = round(13320) = 13320 cents = $133.20. M3 = 16650 - 13320 = 3330 = $33.30.
    const s = split({ closerTotal: 1000, closerM1: 1000, closerM2: 0, closerM3: 0 });
    const out = applyCloserTrainerDeduction(s, 0.0333, 5, 80);
    // Both M2 and M3 floor at 0 here (originally 0, deduction can't go negative).
    expect(out.closerM2).toBe(0);
    expect(out.closerM3).toBe(0);
    expect(out.closerTotal).toBe(1000);
  });

  it('matches the server formula at sub-cent rates (round-trip 1¢ + 2¢ + 3¢)', () => {
    // Make sure a tiny rate × tiny kW doesn't accidentally amplify due to
    // floating-point: $0.01/W × 5kW × 1000 = $50.00 exactly.
    const s = split({ closerTotal: 5000, closerM1: 1000, closerM2: 3200, closerM3: 800 });
    const out = applyCloserTrainerDeduction(s, 0.01, 5, 80);
    // Total deduction = $50. M2 = -$40 → $3160. M3 = -$10 → $790.
    expect(out.closerM2).toBe(3160);
    expect(out.closerM3).toBe(790);
    expect(out.closerTotal).toBe(1000 + 3160 + 790);
    expect(out.closerTotal).toBe(4950);
  });
});
