/**
 * phase-weighted-boost.test.ts — coverage for computePhaseWeightedBoost.
 *
 * Locks in the per-milestone × per-phase × per-horizon credit math.
 * No outer 0.15 factor — the per-milestone tables ARE the credit
 * fractions. Includes M1 (only "New" has pending M1), M2 (pre-Install
 * phases), and M3 (all non-Completed phases, with Installed/PTO
 * dominating short horizons).
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
    m3Amount: 5000,
    setterM1Amount: 800,
    setterM2Amount: 1500,
    setterM3Amount: 3000,
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
    it('daysRemaining ≤ 45 → uses 30-day table', () => {
      const p = project({ phase: 'Pending Install' });
      // 30d: m2 × 0.80 + m3 × 0.02 = 2000 × 0.80 + 5000 × 0.02 = 1600 + 100 = 1700
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(1700);
    });

    it('45 < daysRemaining ≤ 135 → uses 90-day table', () => {
      const p = project({ phase: 'Pending Install' });
      // 90d: m2 × 1.0 + m3 × 0.15 = 2000 + 750 = 2750
      expect(computePhaseWeightedBoost([p], REP, 90)).toBe(2750);
    });

    it('daysRemaining > 135 → uses 365-day table', () => {
      const p = project({ phase: 'Pending Install' });
      // 365d: m2 × 1.0 + m3 × 0.85 = 2000 + 4250 = 6250
      expect(computePhaseWeightedBoost([p], REP, 231)).toBe(6250);
    });

    it('daysRemaining = null → uses 365-day table', () => {
      const p = project({ phase: 'Pending Install' });
      expect(computePhaseWeightedBoost([p], REP, null)).toBe(6250);
    });
  });

  describe('M1 only fires for "New" phase', () => {
    it('"New" contributes M1 at horizon table rate', () => {
      const p = project({ phase: 'New' });
      // 365d: m1 × 1.0 + m2 × 1.0 + m3 × 0.40 = 1000 + 2000 + 2000 = 5000
      expect(computePhaseWeightedBoost([p], REP, 365)).toBe(5000);
    });

    it('"Acceptance" does NOT contribute M1 (already fired)', () => {
      const p = project({ phase: 'Acceptance' });
      // 365d: m2 × 1.0 + m3 × 0.45 = 2000 + 2250 = 4250. NO m1.
      expect(computePhaseWeightedBoost([p], REP, 365)).toBe(4250);
    });

    it('"New" at 30d uses M1 30-day multiplier', () => {
      const p = project({ phase: 'New' });
      // 30d: m1 × 0.50 + m2 × 0.02 + m3 × 0 = 500 + 40 = 540
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(540);
    });
  });

  describe('M2 phase coverage at 30-day horizon', () => {
    const horizonExpect = (phase: string, expectedM2Mult: number) => {
      const p = project({ phase });
      // Only 'New' has M1 pending; only Pending Install has M3 at 30d
      // among pre-Install phases.
      const m1At30 = phase === 'New' ? 0.50 : 0;
      const m3At30 = phase === 'Pending Install' ? 0.02 : 0;
      const expected = Math.round(1000 * m1At30 + 2000 * expectedM2Mult + 5000 * m3At30);
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(expected);
    };

    it('New: M2 × 0.02', () => horizonExpect('New', 0.02));
    it('Acceptance: M2 × 0.05', () => horizonExpect('Acceptance', 0.05));
    it('Site Survey: M2 × 0.10', () => horizonExpect('Site Survey', 0.10));
    it('Design: M2 × 0.20', () => horizonExpect('Design', 0.20));
    it('Permitting: M2 × 0.40', () => horizonExpect('Permitting', 0.40));
    it('Pending Install: M2 × 0.80 + M3 × 0.02', () => horizonExpect('Pending Install', 0.80));
  });

  describe('M3 phase coverage', () => {
    it('Installed contributes M3 at 30d (M2 already fired)', () => {
      const p = project({ phase: 'Installed' });
      // 30d Installed: m3 × 0.20 = 1000. No M1 or M2.
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(1000);
    });

    it('PTO contributes M3 at 30d', () => {
      const p = project({ phase: 'PTO' });
      // 30d PTO: m3 × 0.50 = 2500
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(2500);
    });

    it('Installed at 365d → full M3', () => {
      const p = project({ phase: 'Installed' });
      // 365d: m3 × 1.0 = 5000
      expect(computePhaseWeightedBoost([p], REP, 365)).toBe(5000);
    });

    it('PTO at 90d → full M3', () => {
      const p = project({ phase: 'PTO' });
      // 90d: m3 × 1.0 = 5000
      expect(computePhaseWeightedBoost([p], REP, 90)).toBe(5000);
    });
  });

  describe('Excluded phases', () => {
    it('Cancelled contributes 0', () => {
      expect(computePhaseWeightedBoost([project({ phase: 'Cancelled' })], REP, 365)).toBe(0);
    });
    it('On Hold contributes 0', () => {
      expect(computePhaseWeightedBoost([project({ phase: 'On Hold' })], REP, 365)).toBe(0);
    });
    it('Completed contributes 0 (M3 already paid)', () => {
      expect(computePhaseWeightedBoost([project({ phase: 'Completed' })], REP, 365)).toBe(0);
    });
  });

  describe('Role-aware viewer resolution', () => {
    it('Primary closer takes m{1,2,3}Amount fields', () => {
      const p = project({ phase: 'Pending Install', repId: REP });
      // 30d: m2(2000) × 0.80 + m3(5000) × 0.02 = 1700
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(1700);
    });

    it('Primary setter takes setterM{1,2,3}Amount fields', () => {
      const p = project({ phase: 'Pending Install', repId: OTHER, setterId: REP });
      // 30d: setterM2(1500) × 0.80 + setterM3(3000) × 0.02 = 1200 + 60 = 1260
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(1260);
    });

    it('Additional closer takes their row amounts', () => {
      const p = project({
        phase: 'Pending Install',
        repId: OTHER,
        setterId: 'rep_D',
        additionalClosers: [{ userId: REP, m1Amount: 500, m2Amount: 1000, m3Amount: 2000 }],
      });
      // 30d: m2(1000) × 0.80 + m3(2000) × 0.02 = 800 + 40 = 840
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(840);
    });

    it('Additional setter takes their row amounts', () => {
      const p = project({
        phase: 'Pending Install',
        repId: OTHER,
        setterId: 'rep_D',
        additionalSetters: [{ userId: REP, m1Amount: 300, m2Amount: 600, m3Amount: 1200 }],
      });
      // 30d: m2(600) × 0.80 + m3(1200) × 0.02 = 480 + 24 = 504
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(504);
    });

    it('Not on the deal contributes 0', () => {
      const p = project({ phase: 'Pending Install', repId: OTHER, setterId: 'rep_D' });
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(0);
    });
  });

  describe('Multi-deal aggregation', () => {
    it('sums contributions across deals at different phases', () => {
      const projects = [
        project({ phase: 'Pending Install', m2Amount: 1000, m3Amount: 0 }),
        project({ phase: 'Permitting', m2Amount: 1000, m3Amount: 0 }),
        project({ phase: 'Design', m2Amount: 1000, m3Amount: 0 }),
      ];
      // 30d: 1000 × 0.80 + 1000 × 0.40 + 1000 × 0.20 = 800 + 400 + 200 = 1400
      expect(computePhaseWeightedBoost(projects, REP, 30)).toBe(1400);
    });
  });

  describe('Edge: M3 null is treated as zero', () => {
    it('Pending Install with null M3 only contributes M2', () => {
      const p = project({ phase: 'Pending Install', m3Amount: null });
      // 30d: m2 × 0.80 + 0 × 0.02 = 1600
      expect(computePhaseWeightedBoost([p], REP, 30)).toBe(1600);
    });
  });
});
