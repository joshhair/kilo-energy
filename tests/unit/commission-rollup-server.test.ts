// Tests for lib/commission-rollup-server.ts :: computeProjectRollupServer.
//
// The load-bearing guarantee: the server rollup reconciles TO THE CENT with
// the client view-model deriveProjectCommissionView (the desktop derive). We
// prove it by running BOTH on one shared scenario and asserting the three
// rollup figures + the trainer-leg total are identical — including the
// deactivated-SolarTech fall-through (the edge case the resolver-unification
// fixed), co-parties, and a projected trainer leg.

import { describe, it, expect } from 'vitest';
import { deriveProjectCommissionView } from '@/app/dashboard/projects/components/detail/commission-derived';
import { computeProjectRollupServer, type RollupProjectInput, type RollupDeps } from '@/lib/commission-rollup-server';
import type {
  Project, ProductCatalogProduct, ProductCatalogPricingVersion,
  SolarTechProduct, InstallerPricingVersion, TrainerAssignment, InstallerBaseline,
} from '@/lib/data';

interface Scenario {
  project: Partial<Project> & { id: string };
  solarTechProducts: SolarTechProduct[];
  productCatalogProducts: ProductCatalogProduct[];
  productCatalogPricingVersions: ProductCatalogPricingVersion[];
  installerPricingVersions: InstallerPricingVersion[];
  trainerAssignments: TrainerAssignment[];
}

/** Build the matching deriveProjectCommissionView args + RollupProjectInput
 *  from ONE scenario, so both consume identical inputs. */
function fromScenario(s: Scenario) {
  const p = s.project;
  const clientArgs = {
    project: p as unknown as Project,
    payrollEntries: [],
    effectiveRole: 'admin' as const,
    effectiveRepId: null,
    trainerAssignments: s.trainerAssignments,
    solarTechProducts: s.solarTechProducts,
    productCatalogProducts: s.productCatalogProducts,
    productCatalogPricingVersions: s.productCatalogPricingVersions,
    installerPricingVersions: s.installerPricingVersions,
  };
  const serverInput: RollupProjectInput = {
    id: p.id,
    installer: p.installer as string,
    solarTechProductId: p.solarTechProductId ?? null,
    installerProductId: p.installerProductId ?? null,
    soldDate: p.soldDate as string,
    baselineOverride: (p.baselineOverride ?? null) as InstallerBaseline | null,
    netPPW: p.netPPW as number,
    kWSize: p.kWSize as number,
    closerId: p.repId as string,
    setterId: p.setterId ?? null,
    trainerId: p.trainerId ?? null,
    trainerRate: p.trainerRate ?? null,
    noChainTrainer: p.noChainTrainer,
    m1Amount: p.m1Amount ?? 0,
    // m2/setterM2 passed RAW (not ?? 0): they are share weights where absent
    // means "full share" — coalescing to 0 would drop a trainer leg. This
    // mirrors how the route must forward the Project value.
    m2Amount: p.m2Amount,
    m3Amount: p.m3Amount ?? null,
    setterM1Amount: p.setterM1Amount ?? 0,
    setterM2Amount: p.setterM2Amount,
    setterM3Amount: p.setterM3Amount ?? null,
    additionalClosers: (p.additionalClosers ?? []).map((c) => ({
      userId: c.userId, userName: c.userName, m1Amount: c.m1Amount ?? 0, m2Amount: c.m2Amount ?? 0, m3Amount: c.m3Amount ?? null,
    })),
    additionalSetters: (p.additionalSetters ?? []).map((c) => ({
      userId: c.userId, userName: c.userName, m1Amount: c.m1Amount ?? 0, m2Amount: c.m2Amount ?? 0, m3Amount: c.m3Amount ?? null,
    })),
  };
  const serverDeps: RollupDeps = {
    solarTechProducts: s.solarTechProducts,
    productCatalogProducts: s.productCatalogProducts,
    productCatalogPricingVersions: s.productCatalogPricingVersions,
    installerPricingVersions: s.installerPricingVersions,
    trainerAssignments: s.trainerAssignments,
    payrollEntries: [],
  };
  return { clientArgs, serverInput, serverDeps };
}

function assertReconciles(s: Scenario) {
  const { clientArgs, serverInput, serverDeps } = fromScenario(s);
  const client = deriveProjectCommissionView(clientArgs);
  const server = computeProjectRollupServer(serverInput, serverDeps);

  // Dollar figures match exactly.
  expect(server.totalCommissionGross).toBe(client.totalCommissionGross);
  expect(server.repCommissionTotal).toBe(client.repCommissionTotal);
  expect(server.kiloMarginAmount).toBe(client.kiloMarginAmount);
  // Cents reconcile (gross = rep + margin).
  expect(server.totalCommissionGrossCents).toBe(server.kiloMarginCents + server.repCommissionTotalCents);
  // Cents == 100 × the dollar figure the client shows.
  expect(server.kiloMarginCents).toBe(Math.round(client.kiloMarginAmount * 100));
  expect(server.totalCommissionGrossCents).toBe(Math.round(client.totalCommissionGross * 100));
  // Trainer-leg total matches what the client summed into repCommissionTotal.
  const serverTrainerTotal = server.trainerLegs.reduce((sum, l) => sum + l.amount, 0);
  const clientTrainerTotal = client.projectedTrainerLegs.reduce((sum, l) => sum + l.amount, 0);
  expect(serverTrainerTotal).toBeCloseTo(clientTrainerTotal, 6);
  return { client, server };
}

const baseProject = (over: Partial<Project> = {}): Partial<Project> & { id: string } => ({
  id: 'proj_1',
  repId: 'closer_1',
  setterId: 'setter_1',
  installer: 'BVI',
  productType: 'Loan',
  soldDate: '2026-04-17',
  netPPW: 3.85,
  kWSize: 8.0,
  m1Amount: 0, m2Amount: 2000, m3Amount: 500,
  setterM1Amount: 1000, setterM2Amount: 800, setterM3Amount: 200,
  additionalClosers: [], additionalSetters: [],
  trainerId: undefined, trainerRate: undefined,
  ...over,
});

describe('computeProjectRollupServer reconciles with the client derive', () => {
  it('baselineOverride path (basic deal)', () => {
    const { server } = assertReconciles({
      project: baseProject({ baselineOverride: { closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 } as InstallerBaseline }),
      solarTechProducts: [], productCatalogProducts: [], productCatalogPricingVersions: [],
      installerPricingVersions: [], trainerAssignments: [],
    });
    // gross = (3.85 - 2.20) * 8 * 1000 = 13,200; rep = 0+2000+500 + 1000+800+200 = 4500; margin = 8700
    expect(server.totalCommissionGrossCents).toBe(1320000);
    expect(server.repCommissionTotalCents).toBe(450000);
    expect(server.kiloMarginCents).toBe(870000);
  });

  it('co-closer + co-setter amounts roll into rep total', () => {
    assertReconciles({
      project: baseProject({
        baselineOverride: { closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 } as InstallerBaseline,
        additionalClosers: [{ userId: 'cc1', userName: 'Co Closer', m1Amount: 0, m2Amount: 400, m3Amount: 100, position: 1 }],
        additionalSetters: [{ userId: 'cs1', userName: 'Co Setter', m1Amount: 0, m2Amount: 150, m3Amount: 50, position: 1 }],
      }) as Partial<Project> & { id: string },
      solarTechProducts: [], productCatalogProducts: [], productCatalogPricingVersions: [],
      installerPricingVersions: [], trainerAssignments: [],
    });
  });

  it('deactivated-SolarTech product falls through to the product-catalog rate (unified ladder)', () => {
    const product: ProductCatalogProduct = {
      id: 'p1', installer: 'BVI', family: 'HDM', name: 'Seg-440 w/PW3',
      tiers: [{ minKW: 0, maxKW: null, closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 }],
    };
    const version: ProductCatalogPricingVersion = {
      id: 'pv1', productId: 'p1', label: 'v1', effectiveFrom: '2020-01-01', effectiveTo: null, tiers: product.tiers,
    };
    // installer SolarTech + a productId NOT in solarTechProducts => getSolarTechBaseline
    // throws => both client and server fall through to the installerProductId path.
    assertReconciles({
      project: baseProject({
        installer: 'SolarTech', solarTechProductId: 'deactivated_999', installerProductId: 'p1', baselineOverride: undefined,
      }),
      solarTechProducts: [], productCatalogProducts: [product], productCatalogPricingVersions: [version],
      installerPricingVersions: [], trainerAssignments: [],
    });
  });

  it('self-gen deal (no setter) — setter total is zero on both sides', () => {
    assertReconciles({
      project: baseProject({
        setterId: undefined, setterM1Amount: 0, setterM2Amount: 0, setterM3Amount: undefined,
        baselineOverride: { closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 } as InstallerBaseline,
      }),
      solarTechProducts: [], productCatalogProducts: [], productCatalogPricingVersions: [],
      installerPricingVersions: [], trainerAssignments: [],
    });
  });

  it('chain-trainer + ABSENT setterM2Amount: setter-trainer leg fires identically (regression)', () => {
    // The adversarial case: a setter whose CHAIN trainer (via trainerAssignments,
    // not a per-project override) earns a leg, on a deal where setterM2Amount is
    // not yet set (undefined). The share weight defaults to 1 ("full share") on
    // BOTH sides — the server must pass the absent value through, NOT coalesce to
    // 0, or the leg silently vanishes and Kilo margin is overstated.
    const trainerAssignments = [
      { id: 'ta1', trainerId: 'trainer_x', traineeId: 'setter_1', tiers: [{ upToDeal: null, ratePerW: 0.05 }] },
    ] as TrainerAssignment[];
    const { client, server } = assertReconciles({
      project: baseProject({
        setterM2Amount: undefined, // not-yet-computed deal
        baselineOverride: { closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 } as InstallerBaseline,
      }),
      solarTechProducts: [], productCatalogProducts: [], productCatalogPricingVersions: [],
      installerPricingVersions: [], trainerAssignments,
    });
    // The setter-trainer leg actually fired (0.05 × 8kW × 1000 × 1.0 = $400) —
    // not a no-op — on both sides.
    expect(client.projectedTrainerLegs.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(400, 6);
    expect(server.trainerLegs.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(400, 6);
  });

  it('noChainTrainer suppresses the chain leg on BOTH sides (Codex HIGH regression)', () => {
    // Admin cleared chain trainers: the setter has a chain trainer, but
    // noChainTrainer=true must suppress the projected leg on client AND server
    // (matching actual payroll). Otherwise the projection would include a leg
    // that never pays, understating Kilo margin.
    const trainerAssignments = [
      { id: 'ta1', trainerId: 'trainer_x', traineeId: 'setter_1', tiers: [{ upToDeal: null, ratePerW: 0.05 }] },
    ] as TrainerAssignment[];
    const base = {
      solarTechProducts: [], productCatalogProducts: [], productCatalogPricingVersions: [],
      installerPricingVersions: [], trainerAssignments,
    };
    const override = { baselineOverride: { closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 } as InstallerBaseline };

    // Sanity: WITHOUT noChainTrainer the leg fires ($400) — proves the chain is real.
    const withLeg = assertReconciles({ project: baseProject({ ...override }), ...base });
    expect(withLeg.server.trainerLegs.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(400, 6);

    // WITH noChainTrainer the leg is gone on both sides, and they still reconcile.
    const cleared = assertReconciles({ project: baseProject({ ...override, noChainTrainer: true }), ...base });
    expect(cleared.server.trainerLegs).toEqual([]);
    expect(cleared.client.projectedTrainerLegs).toEqual([]);
    // Margin is higher by the suppressed $400 leg (rep total drops by 400).
    expect(cleared.server.kiloMarginCents).toBe(withLeg.server.kiloMarginCents + 40000);
  });

  it('per-project trainer override produces a non-zero leg that reconciles', () => {
    const { client, server } = assertReconciles({
      project: baseProject({
        trainerId: 'trainer_x', trainerRate: 0.05,
        baselineOverride: { closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 } as InstallerBaseline,
      }),
      solarTechProducts: [], productCatalogProducts: [], productCatalogPricingVersions: [],
      installerPricingVersions: [], trainerAssignments: [],
    });
    // The trainer path is actually exercised (not a no-op), and the leg
    // structure matches the client's exactly.
    expect(server.trainerLegs.length).toBe(client.projectedTrainerLegs.length);
    expect(server.trainerLegs.reduce((s, l) => s + l.amount, 0)).toBeGreaterThan(0);
  });
});
