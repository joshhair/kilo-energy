/**
 * on-pace-projection.test.ts — locks in the hero number math.
 *
 * Formula (assembled in MobileDashboard.tsx, components live in
 * lib/period-projection.ts):
 *
 *   OnPace(P) = inPeriodCommissionEarned + paceRate × monthsRemainingInP
 *
 *   where:
 *     paceRate                 = dealsPerMonth × avgFullCommissionPerDeal
 *     inPeriodCommissionEarned = Σ viewerFullCommission(p)
 *                                  for p sold inside the period window
 *     monthsRemainingInP       = getPeriodDaysRemaining(P) / 30.44
 *
 * These scenarios are the canonical cases Josh has eyeballed and signed
 * off on — they're what we'll cross-check against real prod data in
 * Phase 3 of the verification plan.
 */

import { describe, it, expect } from 'vitest';
import { computeOnPace, viewerFullCommission } from '@/lib/period-projection';
import type { PipelineProject } from '@/lib/aggregators';

const REP = 'rep_A';

describe('viewerFullCommission', () => {
  it('returns 0 for null repId', () => {
    expect(viewerFullCommission({} as unknown as PipelineProject, null)).toBe(0);
  });

  it('primary closer: M1 + M2 + M3', () => {
    const p = {
      repId: REP,
      m1Amount: 500, m2Amount: 4000, m3Amount: 10000,
    } as unknown as PipelineProject;
    expect(viewerFullCommission(p, REP)).toBe(14500);
  });

  it('primary setter: setter milestones', () => {
    const p = {
      repId: 'other', setterId: REP,
      setterM1Amount: 200, setterM2Amount: 1500, setterM3Amount: 3000,
    } as unknown as PipelineProject;
    expect(viewerFullCommission(p, REP)).toBe(4700);
  });

  it('additional closer: own row amounts', () => {
    const p = {
      repId: 'other', setterId: 'other2',
      additionalClosers: [{ userId: REP, m1Amount: 250, m2Amount: 2000, m3Amount: 5000 }],
    } as unknown as PipelineProject;
    expect(viewerFullCommission(p, REP)).toBe(7250);
  });

  it('not on the deal: 0', () => {
    const p = { repId: 'other', setterId: 'other2' } as unknown as PipelineProject;
    expect(viewerFullCommission(p, REP)).toBe(0);
  });

  it('handles null M3 (older deals)', () => {
    const p = {
      repId: REP,
      m1Amount: 500, m2Amount: 4000, m3Amount: null,
    } as unknown as PipelineProject;
    expect(viewerFullCommission(p, REP)).toBe(4500);
  });
});

describe('computeOnPace — the four canonical scenarios', () => {
  // Scenario A: brand new rep, mid-May, 30 days in, 1 deal × $14.9K.
  //   paceRate          = 1 deal/mo × $14,900 = $14,900/mo
  //   inPeriod earned   = $14,900 (the one deal sold in 2026)
  //   days remaining    = ~230 (mid-May → Dec 31)
  //   OnPace YEAR       ≈ $14,900 + $14,900 × (230/30.44) ≈ $127K
  it('Scenario A — new rep, 1 deal $14.9K mid-May', () => {
    const result = computeOnPace({
      inPeriodCommissionEarned: 14_900,
      paceRate: 14_900,
      daysRemainingInPeriod: 230,
    });
    expect(result).toBeGreaterThanOrEqual(120_000);
    expect(result).toBeLessThanOrEqual(135_000);
  });

  // Scenario B: strong new rep, 60 days in, 5 deals/mo × $8K, 10 deals sold YTD.
  //   paceRate          = 5 × $8,000 = $40,000/mo
  //   inPeriod earned   = 10 × $8,000 = $80,000
  //   days remaining    = ~230
  //   OnPace YEAR       ≈ $80K + $40K × 7.56 = $382K
  it('Scenario B — strong new, 5/mo × $8K mid-May', () => {
    const result = computeOnPace({
      inPeriodCommissionEarned: 80_000,
      paceRate: 40_000,
      daysRemainingInPeriod: 230,
    });
    expect(result).toBeGreaterThanOrEqual(370_000);
    expect(result).toBeLessThanOrEqual(395_000);
  });

  // Scenario C: veteran, 4.5 mo into year, 6 deals/mo × $5K, 27 deals YTD.
  //   paceRate          = 6 × $5,000 = $30,000/mo
  //   inPeriod earned   = 27 × $5,000 = $135,000
  //   days remaining    = ~230
  //   OnPace YEAR       ≈ $135K + $30K × 7.56 = $361K
  it('Scenario C — veteran, 6/mo × $5K mid-May', () => {
    const result = computeOnPace({
      inPeriodCommissionEarned: 135_000,
      paceRate: 30_000,
      daysRemainingInPeriod: 230,
    });
    expect(result).toBeGreaterThanOrEqual(350_000);
    expect(result).toBeLessThanOrEqual(380_000);
  });

  // Scenario D: October starter, end of October, 1 deal × $14.9K.
  //   paceRate          = 1 × $14,900 = $14,900/mo
  //   inPeriod earned   = $14,900
  //   days remaining    = ~60 (Nov + Dec)
  //   OnPace YEAR       ≈ $14,900 + $14,900 × 1.97 = $44K
  it('Scenario D — October starter, 1 deal, end-of-Oct', () => {
    const result = computeOnPace({
      inPeriodCommissionEarned: 14_900,
      paceRate: 14_900,
      daysRemainingInPeriod: 60,
    });
    expect(result).toBeGreaterThanOrEqual(40_000);
    expect(result).toBeLessThanOrEqual(50_000);
  });
});

describe('computeOnPace — invariants and edge cases', () => {
  it('zero rate + zero pipeline = 0', () => {
    expect(computeOnPace({ inPeriodCommissionEarned: 0, paceRate: 0, daysRemainingInPeriod: 230 })).toBe(0);
  });

  it('zero days remaining (period closed) = inPeriod earned only', () => {
    expect(computeOnPace({ inPeriodCommissionEarned: 50_000, paceRate: 14_900, daysRemainingInPeriod: 0 })).toBe(50_000);
  });

  it('negative days remaining clamps to 0 (no negative subtraction)', () => {
    expect(computeOnPace({ inPeriodCommissionEarned: 50_000, paceRate: 14_900, daysRemainingInPeriod: -10 })).toBe(50_000);
  });

  it('this-month horizon (~15 days left) ≈ half month of pace + inPeriod', () => {
    const result = computeOnPace({
      inPeriodCommissionEarned: 14_900,
      paceRate: 14_900,
      daysRemainingInPeriod: 15,
    });
    // 14900 + 14900 × (15/30.44) ≈ 14900 + 7339 = 22,239
    expect(result).toBeGreaterThanOrEqual(21_500);
    expect(result).toBeLessThanOrEqual(23_000);
  });

  it('reconciliation: month + (quarter − month) × N approximates quarter', () => {
    const ratePerMonth = 14_900;
    const monthOnly = computeOnPace({ inPeriodCommissionEarned: ratePerMonth, paceRate: ratePerMonth, daysRemainingInPeriod: 15 });
    const quarter = computeOnPace({ inPeriodCommissionEarned: ratePerMonth * 2, paceRate: ratePerMonth, daysRemainingInPeriod: 45 });
    // Quarter should be roughly 3x the month-only number (with same pace
    // and proportionally larger inPeriod + monthsRemaining).
    expect(quarter / monthOnly).toBeGreaterThanOrEqual(1.5);
    expect(quarter / monthOnly).toBeLessThanOrEqual(3.5);
  });
});
