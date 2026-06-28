// Tests for lib/data-rollup.ts :: buildProjectRollups.
//
// The load-bearing guarantee (besides correct cents): a single BAD deal — a
// deactivated/unknown product, out-of-tier kW, etc. that makes the baseline
// resolver THROW — must be SKIPPED, not allowed to bubble up and 500 the whole
// /api/data hydration. This is the regression test for the adversarially-found
// crash risk.

import { describe, it, expect } from 'vitest';
import { buildProjectRollups, type RawRollupProject } from '@/lib/data-rollup';

function project(over: Partial<RawRollupProject> & { id: string }): RawRollupProject {
  return {
    installer: { name: 'BVI' },
    productId: null,
    soldDate: '2026-04-17',
    baselineOverrideJson: null,
    netPPW: 3.85,
    kWSize: 8.0,
    closerId: 'c1',
    setterId: 's1',
    trainerId: null,
    trainerRate: null,
    noChainTrainer: false,
    m1AmountCents: 0, m2AmountCents: 200000, m3AmountCents: 50000,
    setterM1AmountCents: 100000, setterM2AmountCents: 80000, setterM3AmountCents: 20000,
    additionalClosers: [], additionalSetters: [],
    ...over,
  };
}

const emptyArgs = {
  installerPricingVersions: [],
  products: [],
  productPricingVersions: [],
  trainerAssignments: [] as never,
  payrollEntries: [] as never,
  instIdToName: {},
  solarTechInstallerId: undefined,
  users: [],
  now: new Date('2026-06-25T00:00:00Z'),
};

describe('buildProjectRollups', () => {
  it('computes cents for a good deal (baselineOverride path)', () => {
    const good = project({ id: 'good', baselineOverrideJson: JSON.stringify({ closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 }) });
    const out = buildProjectRollups({ ...emptyArgs, projects: [good] });
    const r = out.get('good')!;
    // gross = (3.85 - 2.20) × 8 × 1000 = 13,200; rep = 4,500; margin = 8,700
    expect(r.totalCommissionGrossCents).toBe(1320000);
    expect(r.kiloMarginCents).toBe(870000);
    expect(r.totalCommissionGrossCents).toBe(r.kiloMarginCents + 450000);
    expect(r.trainerLegs).toEqual([]);
  });

  it('SKIPS a deal whose product is missing instead of throwing (no 500)', () => {
    const bad = project({ id: 'bad', productId: 'deactivated_999', baselineOverrideJson: null });
    // products: [] → getProductCatalogBaselineVersioned throws "unknown product".
    let out: ReturnType<typeof buildProjectRollups> | undefined;
    expect(() => { out = buildProjectRollups({ ...emptyArgs, projects: [bad] }); }).not.toThrow();
    expect(out!.has('bad')).toBe(false);
    expect(out!.size).toBe(0);
  });

  it('a bad deal does not poison the good deals in the same batch', () => {
    const good = project({ id: 'good', baselineOverrideJson: JSON.stringify({ closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 }) });
    const bad = project({ id: 'bad', productId: 'deactivated_999', baselineOverrideJson: null });
    const out = buildProjectRollups({ ...emptyArgs, projects: [bad, good] });
    expect(out.has('bad')).toBe(false);
    expect(out.get('good')?.kiloMarginCents).toBe(870000);
    expect(out.size).toBe(1);
  });
});
