// Tests for lib/commission-server.ts :: computeProjectCommission.
//
// These use concrete pricing / trainer data so they exercise the whole
// resolve-baselines → splitCloserSetterPay → co-party subtraction path,
// not just pure math. Property tests live in commission-invariants.test.ts.

import { describe, it, expect } from 'vitest';
import {
  computeProjectCommission,
  type CommissionDeps,
  type CommissionInputs,
  type TrainerResolverPayrollEntry,
} from '@/lib/commission-server';
import type {
  InstallerPricingVersion,
  ProductCatalogProduct,
  ProductCatalogPricingVersion,
  SolarTechProduct,
  TrainerAssignment,
  InstallerPayConfig,
} from '@/lib/data';

function emptyDeps(overrides: Partial<CommissionDeps> = {}): CommissionDeps {
  return {
    installerPricingVersions: [] as InstallerPricingVersion[],
    solarTechProducts: [] as SolarTechProduct[],
    productCatalogProducts: [] as ProductCatalogProduct[],
    productCatalogPricingVersions: [] as ProductCatalogPricingVersion[],
    trainerAssignments: [] as TrainerAssignment[],
    payrollEntries: [] as TrainerResolverPayrollEntry[],
    installerPayConfigs: {} as Record<string, InstallerPayConfig>,
    ...overrides,
  };
}

function baseInputs(overrides: Partial<CommissionInputs> = {}): CommissionInputs {
  return {
    soldDate: '2026-04-17',
    netPPW: 3.85,
    kWSize: 5.28,
    installer: 'BVI',
    productType: 'Loan',
    closerId: 'closer_1',
    setterId: 'setter_1',
    additionalClosers: [],
    additionalSetters: [],
    ...overrides,
  };
}

describe('computeProjectCommission', () => {
  it('product-catalog path reproduces Timothy-Salunga-shape numbers', () => {
    // Mirror of Timothy's actual deal: BVI + HDM/Seg-440 w/PW3 in the
    // kW 5-10 tier (closer 2.85 / setter 2.95 / kilo 2.20), Loan product,
    // installPayPct=80 (BVI default), no trainer, no co-parties.
    const product: ProductCatalogProduct = {
      id: 'p1',
      installer: 'BVI',
      family: 'HDM',
      name: 'Seg-440 w/PW3',
      tiers: [
        { minKW: 1, maxKW: 5, closerPerW: 3.20, setterPerW: 3.30, kiloPerW: 2.60 },
        { minKW: 5, maxKW: 10, closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 },
        { minKW: 10, maxKW: null, closerPerW: 2.80, setterPerW: 2.90, kiloPerW: 2.15 },
      ],
    };
    const version: ProductCatalogPricingVersion = {
      id: 'pv1',
      productId: 'p1',
      label: 'BVI - CTM',
      effectiveFrom: '2026-04-01',
      effectiveTo: null,
      tiers: product.tiers,
    };

    const out = computeProjectCommission(
      baseInputs({ installerProductId: 'p1' }),
      emptyDeps({
        productCatalogProducts: [product],
        productCatalogPricingVersions: [version],
        installerPayConfigs: { BVI: { installPayPct: 80 } },
      }),
    );

    // Closer total = closerDifferential ($528) + closerHalf ($2,376) = $2,904
    // Setter total = $2,376. m1Flat = $1,000 (kW >= 5). installPayPct = 80.
    expect(out.m1Amount).toBeCloseTo(0, 2);
    expect(out.m2Amount).toBeCloseTo(2323.20, 2);
    expect(out.m3Amount).toBeCloseTo(580.80, 2);
    expect(out.setterM1Amount).toBeCloseTo(1000, 2);
    expect(out.setterM2Amount).toBeCloseTo(1100.80, 2);
    expect(out.setterM3Amount).toBeCloseTo(275.20, 2);
    expect(out.diagnostics.closerPerW).toBeCloseTo(2.85, 3);
    expect(out.diagnostics.setterBaselinePerW).toBeCloseTo(2.95, 3);
    expect(out.diagnostics.pricingSource).toBe('product-catalog');
  });

  it('baselineOverride bypasses every resolver', () => {
    const out = computeProjectCommission(
      baseInputs({
        baselineOverride: { closerPerW: 2.00, setterPerW: 2.10, kiloPerW: 1.50 },
      }),
      emptyDeps({ installerPayConfigs: { BVI: { installPayPct: 80 } } }),
    );
    expect(out.diagnostics.closerPerW).toBeCloseTo(2.00, 3);
    expect(out.diagnostics.setterBaselinePerW).toBeCloseTo(2.10, 3);
    expect(out.diagnostics.pricingSource).toBe('override');
    // diffPerW = 0.10, aboveSplit = (3.85 - 2.10) × 5.28 × 1000 = $9,240
    // closerDiff = $528, closerHalf = $4,620, closerTotal = $5,148
    // setterTotal = $4,620; setterM1 = $1000, setter remainder = $3,620
    expect(out.setterM1Amount).toBeCloseTo(1000, 2);
    expect(out.setterM2Amount).toBeCloseTo(3620 * 0.8, 2);
    expect(out.setterM3Amount).toBeCloseTo(3620 * 0.2, 2);
  });

  it('subtracts co-closer amounts from primary closer amounts', () => {
    const product: ProductCatalogProduct = {
      id: 'p1', installer: 'BVI', family: 'HDM', name: 'Seg-440 w/PW3',
      tiers: [{ minKW: 0, maxKW: null, closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 }],
    };
    const version: ProductCatalogPricingVersion = {
      id: 'pv1', productId: 'p1', label: 'v1', effectiveFrom: '2020-01-01', effectiveTo: null, tiers: product.tiers,
    };
    // Admin enters $400 co-closer M2 + $100 co-closer M3.
    const out = computeProjectCommission(
      baseInputs({
        installerProductId: 'p1',
        additionalClosers: [{ m1Amount: 0, m2Amount: 400, m3Amount: 100 }],
      }),
      emptyDeps({
        productCatalogProducts: [product], productCatalogPricingVersions: [version],
        installerPayConfigs: { BVI: { installPayPct: 80 } },
      }),
    );
    // Primary closer M2 = split($2,323.20) - co($400) = $1,923.20
    // Primary closer M3 = split($580.80) - co($100) = $480.80
    expect(out.m2Amount).toBeCloseTo(1923.20, 2);
    expect(out.m3Amount).toBeCloseTo(480.80, 2);
  });

  it('self-gen (no setter) routes commission to closer M1/M2/M3', () => {
    const product: ProductCatalogProduct = {
      id: 'p1', installer: 'BVI', family: 'HDM', name: 'Seg-440',
      tiers: [{ minKW: 0, maxKW: null, closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 }],
    };
    const version: ProductCatalogPricingVersion = {
      id: 'pv1', productId: 'p1', label: 'v1', effectiveFrom: '2020-01-01', effectiveTo: null, tiers: product.tiers,
    };
    const out = computeProjectCommission(
      baseInputs({ setterId: null, installerProductId: 'p1' }),
      emptyDeps({
        productCatalogProducts: [product], productCatalogPricingVersions: [version],
        installerPayConfigs: { BVI: { installPayPct: 80 } },
      }),
    );
    // Self-gen: closerTotal = (3.85 - 2.85) × 5.28 × 1000 = $5,280
    // closerM1 = min($1,000, $5,280) = $1,000. Remainder $4,280, split 80/20.
    expect(out.m1Amount).toBeCloseTo(1000, 2);
    expect(out.m2Amount).toBeCloseTo(3424, 2);
    expect(out.m3Amount).toBeCloseTo(856, 2);
    expect(out.setterM1Amount).toBeCloseTo(0, 2);
    expect(out.setterM2Amount).toBeCloseTo(0, 2);
  });

  it('sub-dealer deals return zeros (regular rep formula does not apply)', () => {
    const out = computeProjectCommission(
      baseInputs({ subDealerId: 'sd_1' }),
      emptyDeps({ installerPayConfigs: { BVI: { installPayPct: 80 } } }),
    );
    expect(out.m1Amount).toBe(0);
    expect(out.m2Amount).toBe(0);
    expect(out.setterM1Amount).toBe(0);
  });

  it('installPayPct=100 installer returns null M3 slots', () => {
    const out = computeProjectCommission(
      baseInputs({
        installerProductId: 'p1',
        baselineOverride: { closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 },
      }),
      emptyDeps({ installerPayConfigs: { BVI: { installPayPct: 100 } } }),
    );
    expect(out.m3Amount).toBeNull();
    expect(out.setterM3Amount).toBeNull();
  });

  it('per-project trainer override applies to setter split (reduces setter total)', () => {
    // Without a trainer: setterTotal = $2,376 (per the Timothy case).
    // With a trainer override of $0.10/W: aboveSplit shifts — setter
    // baseline effectively becomes 2.95 + 0.10 = 3.05, aboveSplit =
    // (3.85-3.05) × 5.28 × 1000 = $4,224. setterHalf = $2,112.
    const out = computeProjectCommission(
      baseInputs({
        baselineOverride: { closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 },
        trainerId: 'trainer_1',
        trainerRate: 0.10,
      }),
      emptyDeps({ installerPayConfigs: { BVI: { installPayPct: 80 } } }),
    );
    // setterTotal: $2,112. setterM1 flat $1000, remainder $1,112, split 80/20.
    expect(out.setterM1Amount).toBeCloseTo(1000, 2);
    expect(out.setterM2Amount).toBeCloseTo(1112 * 0.8, 2);
    expect(out.setterM3Amount).toBeCloseTo(1112 * 0.2, 2);
    expect(out.diagnostics.trainerRate).toBeCloseTo(0.10, 3);
  });
});
