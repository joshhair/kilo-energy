// Tests for lib/dashboard-profit.ts — the admin dashboard baseline-spread profit
// the native iOS dashboard renders. The guarantee: it equals the web's totalProfit
// — profit = Σ (closerPerW − kiloPerW) × kW × 1000 over the period's non-Cancelled
// / non-On-Hold projects — bucketed by soldDate, in integer cents.

import { describe, it, expect } from 'vitest';
import { computeDashboardProfitCents, resolveDashboardBaseline, type DashboardProfitProject } from '@/lib/dashboard-profit';
import type { ViewBaselineData } from '@/lib/baseline-resolve';

const emptyData = { solarTechProducts: [], productCatalogProducts: [], productCatalogPricingVersions: [], installerPricingVersions: [] } as ViewBaselineData;
const now = new Date(2026, 5, 15); // local June 15 2026 → Q2, year 2026

// baselineOverride short-circuits the ladder so we control closerPerW/kiloPerW.
function deal(over: Partial<DashboardProfitProject> = {}): DashboardProfitProject {
  return { phase: 'Installed', soldDate: '2026-06-10', kWSize: 8, installer: 'X', baselineOverride: { closerPerW: 1.0, kiloPerW: 0.5 } as never, ...over };
}

describe('computeDashboardProfitCents', () => {
  it('profit = (closerPerW − kiloPerW) × kW × 1000, in integer cents', () => {
    // (1.0 − 0.5) × 8 × 1000 = 4000 dollars → 400000 cents
    const r = computeDashboardProfitCents([deal()], emptyData, now);
    expect(r.allTime).toBe(400000);
    expect(r.thisMonth).toBe(400000);
    expect(r.thisQuarter).toBe(400000);
    expect(r.thisYear).toBe(400000);
  });

  it('buckets each project by its soldDate', () => {
    const june = deal({ soldDate: '2026-06-10' });     // this month + quarter + year
    const march = deal({ soldDate: '2026-03-10' });    // this year only (Q1, not June)
    const lastYear = deal({ soldDate: '2025-06-10' });  // allTime only
    const r = computeDashboardProfitCents([june, march, lastYear], emptyData, now);
    expect(r.allTime).toBe(1200000);    // all three
    expect(r.thisYear).toBe(800000);    // june + march
    expect(r.thisQuarter).toBe(400000); // june only
    expect(r.thisMonth).toBe(400000);   // june only
  });

  it('skips Cancelled and On Hold but INCLUDES Completed (mirrors the web)', () => {
    const r = computeDashboardProfitCents([
      deal({ phase: 'Cancelled' }), deal({ phase: 'On Hold' }), deal({ phase: 'Completed' }),
    ], emptyData, now);
    expect(r.allTime).toBe(400000); // only the Completed deal
  });

  it('a THROWING baseline (deactivated/missing product) contributes 0, never throws', () => {
    // SolarTech product not in the (empty) products → getSolarTechBaseline throws → {0,0}.
    const st: DashboardProfitProject = { phase: 'Installed', soldDate: '2026-06-10', kWSize: 8, installer: 'SolarTech', solarTechProductId: 'missing' };
    expect(resolveDashboardBaseline(st, emptyData)).toEqual({ closerPerW: 0, kiloPerW: 0 });
    expect(computeDashboardProfitCents([st], emptyData, now).allTime).toBe(0);
  });

  it('sums dollars then rounds once per period (no per-deal rounding drift)', () => {
    // closer 1.001, kilo 1.000 → spread 0.001 × 1kW × 1000 = $1.00 per deal; ×2 = $2.00.
    const d = deal({ kWSize: 1, baselineOverride: { closerPerW: 1.001, kiloPerW: 1.0 } as never });
    const r = computeDashboardProfitCents([d, d], emptyData, now);
    expect(r.allTime).toBe(200); // $2.00 = 200 cents
  });
});
