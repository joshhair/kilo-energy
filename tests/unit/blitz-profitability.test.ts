// Tests for lib/blitzComputed.ts :: computeBlitzProfitabilityCents +
// computeBlitzProjectMarginsCents. The load-bearing guarantee: the aggregate
// kiloMarginCents reconciles to the client's computeBlitzKiloMargin (the
// function the desktop/mobile Blitz Profitability tab uses), and the per-project
// margins sum to it within per-deal rounding.

import { describe, it, expect } from 'vitest';
import {
  computeBlitzKiloMargin,
  computeBlitzProfitabilityCents,
  computeBlitzProjectMarginsCents,
} from '@/lib/blitzComputed';

const emptyDeps = { solarTechProducts: [], productCatalogProducts: [], installerPricingVersions: [] };

// baselineOverrideJson short-circuits getBlitzProjectBaselines, so deps can be empty.
function project(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    closer: { id: 'u1' }, setter: { id: 'u2' },
    kWSize: 8,
    baselineOverrideJson: JSON.stringify({ closerPerW: 1.0, kiloPerW: 0.5 }),
    additionalClosers: [], additionalSetters: [],
    ...over,
  };
}

const approved = new Set(['u1', 'u2']);

describe('blitz profitability (server)', () => {
  it('aggregate kiloMarginCents reconciles to computeBlitzKiloMargin', () => {
    const blitz = {
      projects: [project()],
      costs: [{ amountCents: 100000, category: 'travel' }],
      participants: [{ joinStatus: 'approved', userId: 'u1' }, { joinStatus: 'approved', userId: 'u2' }],
    };
    const r = computeBlitzProfitabilityCents(blitz, emptyDeps);
    const clientMargin = computeBlitzKiloMargin(blitz.projects, approved, emptyDeps);
    // split deal: margin = (1.0-0.5)*8*1000 − 0.10*8*1000 = 4000 − 800 = 3200
    expect(clientMargin).toBeCloseTo(3200, 6);
    expect(r.kiloMarginCents).toBe(Math.round(clientMargin * 100));
    expect(r.kiloMarginCents).toBe(320000);
    expect(r.totalCostsCents).toBe(100000);
    expect(r.netProfitCents).toBe(220000);
    expect(r.roiBps).toBe(22000); // 220% × 100
    expect(r.costsByCategoryCents).toEqual({ travel: 100000 });
  });

  it('per-project margins sum to the aggregate (to the cent here)', () => {
    const blitz = {
      projects: [project({ id: 'p1' }), project({ id: 'p2', kWSize: 5 })],
      costs: [],
      participants: [{ joinStatus: 'approved', userId: 'u1' }],
    };
    const r = computeBlitzProfitabilityCents(blitz, emptyDeps);
    const perProjectSum = r.projectMarginsCents.reduce((s, m) => s + m.kiloMarginCents, 0);
    expect(perProjectSum).toBe(r.kiloMarginCents);
    expect(r.projectMarginsCents.map((m) => m.projectId)).toEqual(['p1', 'p2']);
  });

  it('self-gen deal (closer === setter) has no setter cost', () => {
    const blitz = {
      projects: [project({ setter: { id: 'u1' } })], // closer === setter → self-gen
      costs: [],
      participants: [{ joinStatus: 'approved', userId: 'u1' }],
    };
    const margins = computeBlitzProjectMarginsCents(blitz.projects, new Set(['u1']), emptyDeps);
    // margin = (1.0-0.5)*8*1000 − 0 = 4000 → 400000 cents (no setterCost)
    expect(margins[0].kiloMarginCents).toBe(400000);
  });

  it('skips deals whose closer is not an approved participant', () => {
    const blitz = {
      projects: [project({ closer: { id: 'rando' }, setter: { id: 'rando2' } })],
      costs: [],
      participants: [{ joinStatus: 'approved', userId: 'u1' }],
    };
    const r = computeBlitzProfitabilityCents(blitz, emptyDeps);
    expect(r.kiloMarginCents).toBe(0);
    expect(r.projectMarginsCents).toEqual([]);
  });

  it('excludes Cancelled / On Hold deals from P&L (Codex HIGH regression)', () => {
    const blitz = {
      projects: [
        project({ id: 'live' }),
        project({ id: 'cancelled', phase: 'Cancelled' }),
        project({ id: 'onhold', phase: 'On Hold' }),
      ],
      costs: [],
      participants: [{ joinStatus: 'approved', userId: 'u1' }, { joinStatus: 'approved', userId: 'u2' }],
    };
    const r = computeBlitzProfitabilityCents(blitz, emptyDeps);
    // Only the live deal counts (320000); cancelled + on-hold excluded.
    expect(r.kiloMarginCents).toBe(320000);
    expect(r.projectMarginsCents.map((m) => m.projectId)).toEqual(['live']);
  });

  it('roiBps is 0 when there are no costs (no divide-by-zero)', () => {
    const blitz = {
      projects: [project()],
      costs: [],
      participants: [{ joinStatus: 'approved', userId: 'u1' }, { joinStatus: 'approved', userId: 'u2' }],
    };
    const r = computeBlitzProfitabilityCents(blitz, emptyDeps);
    expect(r.totalCostsCents).toBe(0);
    expect(r.roiBps).toBe(0);
    expect(r.netProfitCents).toBe(r.kiloMarginCents);
  });

  it('only approved participants count (pending/declined excluded)', () => {
    const blitz = {
      projects: [project()],
      costs: [],
      // u1 approved, u2 pending → split deal but closer u1 approved → still counts
      participants: [{ joinStatus: 'approved', userId: 'u1' }, { joinStatus: 'pending', userId: 'u2' }],
    };
    const r = computeBlitzProfitabilityCents(blitz, emptyDeps);
    expect(r.kiloMarginCents).toBe(320000); // closer approved → deal counts
  });
});
