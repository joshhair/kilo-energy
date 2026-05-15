/**
 * period-projection.test.ts — coverage for computePeriodProjection.
 *
 * The function takes the boost ALREADY scaled to the horizon (caller
 * pre-computes via computePhaseWeightedBoost). So these tests focus
 * on the addition semantics: paid + pace × days/30.44 + boost.
 * Phase-weighted boost math is covered separately in
 * tests/unit/phase-weighted-boost.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { computePeriodProjection } from '@/lib/period-projection';

describe('computePeriodProjection', () => {
  describe('all-time horizon (daysRemaining = null)', () => {
    it('returns monthlyRate × 12 + full boost', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 999, // ignored on all-time path
        monthlyEarningRate: 5000,
        pipelineBoostForHorizon: 1200,
        daysRemaining: null,
      });
      expect(result).toBe(5000 * 12 + 1200);
    });

    it('returns 0 for empty inputs', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 0,
        monthlyEarningRate: 0,
        pipelineBoostForHorizon: 0,
        daysRemaining: null,
      });
      expect(result).toBe(0);
    });

    it('never returns negative — clamps to 0', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 0,
        monthlyEarningRate: -100, // shouldn't happen but defend
        pipelineBoostForHorizon: -50,
        daysRemaining: null,
      });
      expect(result).toBe(0);
    });
  });

  describe('open-period horizon (daysRemaining > 0)', () => {
    it('adds paid + pace × (days/30.44) + boost (no internal scaling)', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 2500,
        monthlyEarningRate: 4000,
        pipelineBoostForHorizon: 1000, // pre-scaled by caller
        daysRemaining: 17,
      });
      // Expected: 2500 + 4000 × (17/30.44) + 1000
      //        = 2500 + 2233.9 + 1000 ≈ 5734
      expect(result).toBeGreaterThan(5700);
      expect(result).toBeLessThan(5800);
    });

    it('this-quarter scenario (~46 days, mid-May → Jun 30)', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 10000,
        monthlyEarningRate: 5000,
        pipelineBoostForHorizon: 13500, // caller did phase-weighted compute
        daysRemaining: 46,
      });
      // Expected: 10000 + 5000 × (46/30.44) + 13500
      //        = 10000 + 7556 + 13500 ≈ 31056
      expect(result).toBeGreaterThan(31000);
      expect(result).toBeLessThan(31200);
    });

    it('this-year scenario (~231 days from May 15)', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 20000,
        monthlyEarningRate: 5000,
        pipelineBoostForHorizon: 15000, // caller used 365-day table (all 1.0) × 0.15 × pipeline
        daysRemaining: 231,
      });
      // Expected: 20000 + 5000 × (231/30.44) + 15000
      //        = 20000 + 37944 + 15000 ≈ 72944
      expect(result).toBeGreaterThan(72900);
      expect(result).toBeLessThan(73000);
    });
  });

  describe('closed period (daysRemaining ≤ 0)', () => {
    it('daysRemaining=0 → returns just paidInPeriodSoFar', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 4250,
        monthlyEarningRate: 5000,
        pipelineBoostForHorizon: 1000,
        daysRemaining: 0,
      });
      expect(result).toBe(4250);
    });

    it('negative daysRemaining (period in past) → returns paidInPeriodSoFar', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 1000,
        monthlyEarningRate: 5000,
        pipelineBoostForHorizon: 1000,
        daysRemaining: -5,
      });
      expect(result).toBe(1000);
    });
  });

  describe('rounding behavior', () => {
    it('returns integer (no fractional dollars)', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 100.7,
        monthlyEarningRate: 200.3,
        pipelineBoostForHorizon: 100.9,
        daysRemaining: 15,
      });
      expect(Number.isInteger(result)).toBe(true);
    });

    it('all components sum: small pace and small boost still round to 0 or small int', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 0,
        monthlyEarningRate: 1, // 1/month
        pipelineBoostForHorizon: 0,
        daysRemaining: 1,
      });
      // 0 + 1 × (1/30.44) + 0 = 0.0329 → rounds to 0
      expect(result).toBe(0);
    });
  });

  describe('cross-period reconciliation invariant', () => {
    // The user-facing requirement: this-year ≥ this-quarter ≥ this-month
    // for a typical rep. Verifies the math doesn't produce weird
    // inversions (e.g., year < quarter because of compound rounding).
    it('a stable rep sees this-year > this-quarter > this-month', () => {
      // Same rep, same rate, varying days remaining + scaled boost
      const month = computePeriodProjection({
        paidInPeriodSoFar: 2000,
        monthlyEarningRate: 5000,
        pipelineBoostForHorizon: 1500, // ~ 30-day phase-weighted boost
        daysRemaining: 17,
      });
      const quarter = computePeriodProjection({
        paidInPeriodSoFar: 10000,
        monthlyEarningRate: 5000,
        pipelineBoostForHorizon: 9000, // ~ 90-day phase-weighted boost
        daysRemaining: 46,
      });
      const year = computePeriodProjection({
        paidInPeriodSoFar: 20000,
        monthlyEarningRate: 5000,
        pipelineBoostForHorizon: 15000, // ~ full annual boost
        daysRemaining: 231,
      });
      expect(year).toBeGreaterThan(quarter);
      expect(quarter).toBeGreaterThan(month);
    });
  });
});
