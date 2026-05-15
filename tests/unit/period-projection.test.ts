/**
 * period-projection.test.ts — coverage for computePeriodProjection.
 *
 * Locks in the period-scoped projection math the mobile dashboard
 * hero card uses for the "On Pace · This Month / Quarter" headlines.
 * Pure function; tests are deterministic.
 */

import { describe, it, expect } from 'vitest';
import { computePeriodProjection } from '@/lib/period-projection';

describe('computePeriodProjection', () => {
  describe('all-time horizon (daysRemaining = null)', () => {
    it('returns monthlyRate × 12 + pipelineBoost', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 999, // ignored on all-time path
        monthlyEarningRate: 5000,
        pipelineBoostAnnual: 1200,
        daysRemaining: null,
      });
      expect(result).toBe(5000 * 12 + 1200);
    });

    it('returns 0 for empty inputs', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 0,
        monthlyEarningRate: 0,
        pipelineBoostAnnual: 0,
        daysRemaining: null,
      });
      expect(result).toBe(0);
    });

    it('never returns negative — clamps to 0', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 0,
        monthlyEarningRate: -100, // shouldn't happen but defend
        pipelineBoostAnnual: -50,
        daysRemaining: null,
      });
      expect(result).toBe(0);
    });
  });

  describe('open-period horizon (daysRemaining > 0)', () => {
    it('this-month case (~30 days) — adds ~1 month of pace + 8% of boost', () => {
      // 17 days remaining (mid-May → June 1)
      const result = computePeriodProjection({
        paidInPeriodSoFar: 2500,
        monthlyEarningRate: 4000,
        pipelineBoostAnnual: 6000,
        daysRemaining: 17,
      });
      // Expected: 2500 + 4000 × (17/30.44) + 6000 × (17/365)
      //        = 2500 + 2233.9 + 279.5 ≈ 5013
      expect(result).toBeGreaterThan(4900);
      expect(result).toBeLessThan(5100);
    });

    it('this-quarter case (~90 days) — adds ~3 months of pace + ~25% of boost', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 8000,
        monthlyEarningRate: 4000,
        pipelineBoostAnnual: 6000,
        daysRemaining: 78, // about 11 weeks into Q
      });
      // Expected: 8000 + 4000 × (78/30.44) + 6000 × (78/365)
      //        = 8000 + 10249.7 + 1282.2 ≈ 19532
      expect(result).toBeGreaterThan(19400);
      expect(result).toBeLessThan(19700);
    });

    it('this-year case (~231 days from May 15) — close to annual but not identical', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 20000,
        monthlyEarningRate: 5000,
        pipelineBoostAnnual: 12000,
        daysRemaining: 231,
      });
      // Expected: 20000 + 5000 × (231/30.44) + 12000 × (231/365)
      //        = 20000 + 37944 + 7594 ≈ 65538
      expect(result).toBeGreaterThan(65000);
      expect(result).toBeLessThan(66000);
    });
  });

  describe('closed period (daysRemaining ≤ 0)', () => {
    it('daysRemaining=0 → returns just paidInPeriodSoFar', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 4250,
        monthlyEarningRate: 5000,
        pipelineBoostAnnual: 1000,
        daysRemaining: 0,
      });
      expect(result).toBe(4250);
    });

    it('negative daysRemaining (period in past) → returns paidInPeriodSoFar', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 1000,
        monthlyEarningRate: 5000,
        pipelineBoostAnnual: 1000,
        daysRemaining: -5,
      });
      expect(result).toBe(1000);
    });
  });

  describe('linear horizon scaling — pipeline boost component', () => {
    it('30 days → ~8% of annual boost', () => {
      const a = computePeriodProjection({
        paidInPeriodSoFar: 0,
        monthlyEarningRate: 0,
        pipelineBoostAnnual: 12000,
        daysRemaining: 30,
      });
      // 12000 × (30/365) ≈ 986
      expect(a).toBeGreaterThan(950);
      expect(a).toBeLessThan(1020);
    });

    it('365 days → full annual boost', () => {
      const a = computePeriodProjection({
        paidInPeriodSoFar: 0,
        monthlyEarningRate: 0,
        pipelineBoostAnnual: 12000,
        daysRemaining: 365,
      });
      expect(a).toBe(12000);
    });

    it('twice the days → twice the boost (linear)', () => {
      const at30 = computePeriodProjection({
        paidInPeriodSoFar: 0,
        monthlyEarningRate: 0,
        pipelineBoostAnnual: 12000,
        daysRemaining: 30,
      });
      const at60 = computePeriodProjection({
        paidInPeriodSoFar: 0,
        monthlyEarningRate: 0,
        pipelineBoostAnnual: 12000,
        daysRemaining: 60,
      });
      expect(at60).toBeCloseTo(at30 * 2, -1); // tolerance for rounding
    });
  });

  describe('rounding behavior', () => {
    it('rounds the final result, not intermediates', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 0,
        monthlyEarningRate: 1, // 1/month
        pipelineBoostAnnual: 0,
        daysRemaining: 1,
      });
      // 0 + 1 × (1/30.44) + 0 = 0.0329 → rounds to 0
      expect(result).toBe(0);
    });

    it('returns integer (no fractional dollars)', () => {
      const result = computePeriodProjection({
        paidInPeriodSoFar: 100.7,
        monthlyEarningRate: 200.3,
        pipelineBoostAnnual: 100.9,
        daysRemaining: 15,
      });
      expect(Number.isInteger(result)).toBe(true);
    });
  });
});
