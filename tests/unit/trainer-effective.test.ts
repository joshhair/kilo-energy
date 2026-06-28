// Tests for lib/trainer-effective.ts — the viewing rep's effective baseline.
// The load-bearing guarantee: effectiveCloserPerW/effectiveSetterPerW = base +
// the rep's current-tier override (getTrainerOverrideRate), the SAME override on
// both sides — reconciling to what the web calculator (repointed) + iOS render.

import { describe, it, expect } from 'vitest';
import { viewerTrainerOverridePerW, effectiveRateFields } from '@/lib/trainer-effective';
import { getTrainerOverrideRate, type TrainerAssignment } from '@/lib/data';

const assignment: TrainerAssignment = {
  id: 'ta1', trainerId: 'trainer', traineeId: 'me', isActiveTraining: true,
  tiers: [{ upToDeal: 2, ratePerW: 0.30 }, { upToDeal: null, ratePerW: 0.10 }],
};

describe('viewerTrainerOverridePerW', () => {
  it('resolves the current tier from consumedDeals (reconciles to getTrainerOverrideRate)', () => {
    expect(viewerTrainerOverridePerW(assignment, 0)).toBe(0.30); // tier 0
    expect(viewerTrainerOverridePerW(assignment, 1)).toBe(0.30); // 1 < 2 → tier 0
    expect(viewerTrainerOverridePerW(assignment, 2)).toBe(0.10); // 2 ≥ 2 → perpetual tier
    expect(viewerTrainerOverridePerW(assignment, 5)).toBe(0.10);
    // matches the raw fn for any count
    for (const n of [0, 1, 2, 3, 9]) {
      expect(viewerTrainerOverridePerW(assignment, n)).toBe(getTrainerOverrideRate(assignment, n));
    }
  });

  it('returns 0 when the rep has no trainee assignment', () => {
    expect(viewerTrainerOverridePerW(null, 5)).toBe(0);
    expect(viewerTrainerOverridePerW(undefined, 0)).toBe(0);
  });
});

describe('effectiveRateFields', () => {
  it('adds the SAME override to closer and setter base', () => {
    // $/W display values (rendered to 2dp) — toBeCloseTo for JS float adds.
    const a = effectiveRateFields({ closerPerW: 1.00, setterPerW: 0.50 }, 0.15) as Record<string, number>;
    expect(a.effectiveCloserPerW).toBeCloseTo(1.15, 6);
    expect(a.effectiveSetterPerW).toBeCloseTo(0.65, 6);
    const b = effectiveRateFields({ closerPerW: 0.80, setterPerW: 0.40 }, 0.15) as Record<string, number>;
    expect(b.effectiveCloserPerW).toBeCloseTo(0.95, 6);
    expect(b.effectiveSetterPerW).toBeCloseTo(0.55, 6);
  });

  it('treats a missing setterPerW as 0 for the effective setter rate', () => {
    const out = effectiveRateFields({ closerPerW: 1.00, setterPerW: undefined }, 0.20) as Record<string, number>;
    expect(out.effectiveCloserPerW).toBeCloseTo(1.20, 6);
    expect(out.effectiveSetterPerW).toBeCloseTo(0.20, 6);
  });

  it('returns {} when override <= 0 so non-trainees keep the bare base (no effective fields)', () => {
    expect(effectiveRateFields({ closerPerW: 1.00, setterPerW: 0.50 }, 0)).toEqual({});
    expect(effectiveRateFields({ closerPerW: 1.00, setterPerW: 0.50 }, -1)).toEqual({});
  });
});
