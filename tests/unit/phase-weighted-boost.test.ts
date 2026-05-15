/**
 * phase-weighted-boost.test.ts — coverage for computePhaseWeightedBoost.
 *
 * Locks in the phase × horizon multiplier behavior the period-scoped
 * projection depends on. Verifies that:
 *   - Late-phase deals dominate short-horizon boost
 *   - Early-phase deals contribute less at short horizons, more at long
 *   - At daysRemaining=null (all-time), every phase counts at 1.0 →
 *     boost = 0.15 × full pipeline (legacy annual semantics preserved)
 *   - Cancelled / Installed / PTO / Completed contribute 0
 *   - 'New' phase contributes M1 + M2 (M1 hasn't fired yet)
 *   - Acceptance+ phases contribute only M2 (M1 already fired)
 *   - Role-aware viewer resolution (closer / setter / co-party)
 *   - 0.15 outer factor applied uniformly
 */

import { describe, it, expect } from 'vitest';
import { computePhaseWeightedBoost } from '@/lib/period-projection';
import type { PipelineProject } from '@/lib/aggregators';

const REP = 'rep_A';
const SETTER = 'rep_B';
const OTHER = 'rep_C';

function project(overrides: Partial<PipelineProject> = {}): PipelineProject {
  return {
    soldDate: '2026-05-01',
    phase: 'Pending Install',
    repId: REP,
    setterId: SETTER,
    m1Amount: 1000,
    m2Amount: 2000,
    m3Amount: 500,
    setterM1Amount: 800,
    setterM2Amount: 1500,
    setterM3Amount: 300,
    additionalClosers: [],
    additionalSetters: [],
    ...overrides,
  };
}

describe('computePhaseWeightedBoost', () => {
  describe('null repId', () => {
    it('returns 0 — no viewer to compute for', () => {
      expect(computePhaseWeightedBoost([project()], null, 30)).toBe(0);
    });
  });

  describe('horizon table selection', () => {
    it('daysRemaining ≤ 45 → uses 30-day table (Pending Install at 0.80)', () => {
      const p = project({ phase: 'Pending Install' });
      // closer: m2 = 2000. boost = 0.15 × 0.80 × 2000 = 240
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(240);
    });

    it('45 < daysRemaining ≤ 135 → uses 90-day table (Pending Install at 1.0)', () => {
      const p = project({ phase: 'Pending Install' });
      // closer: m2 = 2000. boost = 0.15 × 1.0 × 2000 = 300
      expect(computePhaseWeightedBoost([p], REP, 90)).toBe(300);
    });

    it('daysRemaining > 135 → uses 365-day table (everything 1.0)', () => {
      const p = project({ phase: 'New' });
      // 'New' contributes m1+m2 = 1000+2000 = 3000. boost = 0.15 × 1.0 × 3000 = 450
      expect(computePhaseWeightedBoost([p], REP, 231)).toBe(450);
    });

    it('daysRemaining = null → uses 365-day table (all-time annual)', () => {
      const p = project({ phase: 'New' });
      expect(computePhaseWeightedBoost([p], REP, null)).toBe(450);
    });
  });

  describe('phase-specific weights at 30-day horizon', () => {
    it('Installed contributes 0 (already in paid history)', () => {
      const p = project({ phase: 'Installed' });
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(0);
    });

    it('PTO contributes 0', () => {
      const p = project({ phase: 'PTO' });
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(0);
    });

    it('Completed contributes 0', () => {
      const p = project({ phase: 'Completed' });
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(0);
    });

    it('Cancelled contributes 0', () => {
      const p = project({ phase: 'Cancelled' });
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(0);
    });

    it('On Hold contributes 0 (limbo, not actively closing)', () => {
      const p = project({ phase: 'On Hold' });
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(0);
    });

    it('Pending Install at 30d → 0.80 × m2', () => {
      const p = project({ phase: 'Pending Install', m2Amount: 5000 });
      // 0.15 × 0.80 × 5000 = 600
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(600);
    });

    it('Permitting at 30d → 0.40 × m2', () => {
      const p = project({ phase: 'Permitting', m2Amount: 5000 });
      // 0.15 × 0.40 × 5000 = 300
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(300);
    });

    it('New at 30d → 0.02 × (m1+m2)', () => {
      const p = project({ phase: 'New', m1Amount: 1000, m2Amount: 5000 });
      // 0.15 × 0.02 × (1000+5000) = 18
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(18);
    });
  });

  describe('M1 inclusion rule', () => {
    it("'New' phase contributes M1 (M1 hasn't fired yet)", () => {
      const p = project({ phase: 'New', m1Amount: 1000, m2Amount: 0 });
      // 0.15 × 1.0 × 1000 = 150 at long horizon
      expect(computePhaseWeightedBoost([p], REP, 365)).toBe(150);
    });

    it("'Acceptance' phase does NOT contribute M1 (M1 already fired)", () => {
      const p = project({ phase: 'Acceptance', m1Amount: 1000, m2Amount: 0 });
      // 0.15 × 1.0 × 0 = 0
      expect(computePhaseWeightedBoost([p], REP, 365)).toBe(0);
    });

    it("'Site Survey' phase contributes only M2", () => {
      const p = project({ phase: 'Site Survey', m1Amount: 9999, m2Amount: 1000 });
      // m1 ignored. 0.15 × 1.0 × 1000 = 150
      expect(computePhaseWeightedBoost([p], REP, 365)).toBe(150);
    });
  });

  describe('role-aware viewer resolution', () => {
    it('primary closer takes m1+m2 fields', () => {
      const p = project({ phase: 'New', m1Amount: 1000, m2Amount: 2000 });
      expect(computePhaseWeightedBoost([p], REP, 365)).toBe(Math.round(0.15 * 3000));
    });

    it('primary setter takes setter* fields', () => {
      const p = project({ phase: 'New', setterM1Amount: 800, setterM2Amount: 1500 });
      expect(computePhaseWeightedBoost([p], SETTER, 365)).toBe(Math.round(0.15 * 2300));
    });

    it('co-closer takes that party row m1+m2', () => {
      const p = project({
        phase: 'New',
        repId: OTHER,
        setterId: 'rep_setter',
        additionalClosers: [{ userId: REP, m1Amount: 300, m2Amount: 600, m3Amount: 100 }],
      });
      // m1+m2 = 900. 0.15 × 1.0 × 900 = 135
      expect(computePhaseWeightedBoost([p], REP, 365)).toBe(135);
    });

    it('co-setter takes that party row m1+m2', () => {
      const p = project({
        phase: 'New',
        repId: OTHER,
        setterId: 'rep_setter',
        additionalSetters: [{ userId: REP, m1Amount: 200, m2Amount: 400, m3Amount: 100 }],
      });
      // m1+m2 = 600. 0.15 × 1.0 × 600 = 90
      expect(computePhaseWeightedBoost([p], REP, 365)).toBe(90);
    });

    it('not on deal → contributes 0', () => {
      const p = project({
        phase: 'New',
        repId: OTHER,
        setterId: 'rep_setter',
        additionalClosers: [],
        additionalSetters: [],
      });
      expect(computePhaseWeightedBoost([p], REP, 365)).toBe(0);
    });
  });

  describe('365-day horizon = annual legacy semantics', () => {
    it('boost = 0.15 × full pipeline (matches today\'s annual boost)', () => {
      const projects: PipelineProject[] = [
        project({ phase: 'New', m1Amount: 1000, m2Amount: 2000 }),
        project({ phase: 'Permitting', m1Amount: 999, m2Amount: 3000 }), // m1 ignored
        project({ phase: 'Pending Install', m2Amount: 4000 }),
      ];
      // At 365d, all phases = 1.0
      // 'New': m1+m2 = 3000
      // 'Permitting': m2 only = 3000
      // 'Pending Install': m2 only = 4000
      // Total = 10000. boost = 0.15 × 10000 = 1500
      expect(computePhaseWeightedBoost(projects, REP, 365)).toBe(1500);
    });

    it('null horizon and 365-day horizon return same value', () => {
      const projects: PipelineProject[] = [
        project({ phase: 'New' }),
        project({ phase: 'Permitting' }),
        project({ phase: 'Pending Install' }),
      ];
      const annual = computePhaseWeightedBoost(projects, REP, null);
      const at365 = computePhaseWeightedBoost(projects, REP, 365);
      expect(annual).toBe(at365);
    });
  });

  describe('short horizon emphasizes late-phase pipeline', () => {
    it('30-day boost on late-phase pipeline > 30-day boost on early-phase pipeline', () => {
      const latePhase = computePhaseWeightedBoost(
        [project({ phase: 'Pending Install', m2Amount: 10000 })],
        REP,
        30,
      );
      const earlyPhase = computePhaseWeightedBoost(
        [project({ phase: 'New', m1Amount: 0, m2Amount: 10000 })],
        REP,
        30,
      );
      expect(latePhase).toBeGreaterThan(earlyPhase);
    });

    it('the same $10K of M2 pipeline at late-phase → much bigger short-horizon boost', () => {
      // Late: 0.15 × 0.80 × 10000 = 1200
      // Early: 0.15 × 0.02 × 10000 = 30
      // Ratio: 40x
      const late = computePhaseWeightedBoost(
        [project({ phase: 'Pending Install', m2Amount: 10000 })],
        REP,
        30,
      );
      const early = computePhaseWeightedBoost(
        [project({ phase: 'New', m1Amount: 0, m2Amount: 10000 })],
        REP,
        30,
      );
      expect(late / early).toBeGreaterThan(30);
    });
  });

  describe('multiple deals aggregation', () => {
    it('sums contributions across deals at different phases', () => {
      const projects: PipelineProject[] = [
        project({ phase: 'Pending Install', m2Amount: 1000 }), // 30d: 0.80 × 1000 = 800
        project({ phase: 'Permitting', m2Amount: 1000 }),       // 30d: 0.40 × 1000 = 400
        project({ phase: 'Design', m2Amount: 1000 }),           // 30d: 0.20 × 1000 = 200
        project({ phase: 'Cancelled' }),                        // 0
        project({ phase: 'Installed' }),                        // 0 (excluded)
      ];
      // Sum of weighted m2 = 800 + 400 + 200 = 1400
      // Boost = 0.15 × 1400 = 210
      expect(computePhaseWeightedBoost(projects, REP, 30)).toBe(210);
    });
  });

  describe('empty inputs', () => {
    it('empty project list → 0', () => {
      expect(computePhaseWeightedBoost([], REP, 30)).toBe(0);
    });

    it('all projects cancelled → 0', () => {
      const projects: PipelineProject[] = [
        project({ phase: 'Cancelled' }),
        project({ phase: 'Cancelled' }),
      ];
      expect(computePhaseWeightedBoost(projects, REP, 30)).toBe(0);
    });
  });
});
