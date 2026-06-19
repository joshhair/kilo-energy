import { describe, it, expect } from 'vitest';
import {
  getActiveInstallerVersion,
  getActiveProductCatalogVersion,
  getInstallerRatesForDeal,
  getProductCatalogBaselineVersioned,
  type InstallerPricingVersion,
  type ProductCatalogPricingVersion,
  type ProductCatalogProduct,
} from '@/lib/data';

// The load-bearing Stage A invariant, proven at the RESOLVER level:
// publishing a FUTURE-dated version must NEVER change the rates an existing/sold
// deal resolves to. All deal resolution flows through these helpers, which
// select by effectiveFrom <= soldDate — so a future version is structurally
// excluded. These tests would fail loudly if a refactor ever let a future
// version win (e.g. switching to a naive "latest open version" pick).

const TIER = (closer: number, kilo: number) => ({ minKW: 1, maxKW: null as number | null, closerPerW: closer, setterPerW: Math.round((closer + 0.1) * 100) / 100, kiloPerW: kilo });

describe('installer version resolution ignores future-dated publishes', () => {
  // Current version (effective since Jan, closed the day before the future one),
  // plus a future-dated publish — exactly what bulk-version-create produces.
  const versions: InstallerPricingVersion[] = [
    { id: 'cur', installer: 'ESP', label: 'current', effectiveFrom: '2026-01-01', effectiveTo: '2026-06-17', rates: { type: 'flat', closerPerW: 2.9, kiloPerW: 2.35 } },
    { id: 'fut', installer: 'ESP', label: 'future', effectiveFrom: '2026-06-18', effectiveTo: null, rates: { type: 'flat', closerPerW: 2.5, kiloPerW: 2.0 } },
  ];
  it('resolves the version effective at soldDate, not the future one', () => {
    expect(getActiveInstallerVersion('ESP', '2026-06-09', versions)?.id).toBe('cur');
  });
  it('rates for an existing deal are the current (not future) rates', () => {
    const r = getInstallerRatesForDeal('ESP', '2026-06-09', 8, versions);
    expect(r).toMatchObject({ closerPerW: 2.9, kiloPerW: 2.35, versionId: 'cur' });
  });
  it('defensive: a future open version is excluded even if the current was NOT closed', () => {
    const bothOpen: InstallerPricingVersion[] = [
      { ...versions[0], effectiveTo: null },
      versions[1],
    ];
    expect(getActiveInstallerVersion('ESP', '2026-06-09', bothOpen)?.id).toBe('cur');
  });
  it('the future version DOES win once its effective date arrives (sanity)', () => {
    expect(getActiveInstallerVersion('ESP', '2026-06-18', versions)?.id).toBe('fut');
  });
});

describe('product-catalog / SolarTech version resolution ignores future-dated publishes', () => {
  const products: ProductCatalogProduct[] = [
    { id: 'p1', installer: 'SolarTech', family: 'Enfin', name: 'Q.TRON', tiers: [TIER(2.9, 2.4)] },
  ];
  const versions: ProductCatalogPricingVersion[] = [
    { id: 'cur', productId: 'p1', label: 'current', effectiveFrom: '2026-01-01', effectiveTo: '2026-06-17', tiers: [TIER(2.9, 2.4)] },
    { id: 'fut', productId: 'p1', label: 'future', effectiveFrom: '2026-06-18', effectiveTo: null, tiers: [TIER(2.5, 2.0)] },
  ];
  it('resolves the version effective at soldDate, not the future one', () => {
    expect(getActiveProductCatalogVersion('p1', '2026-06-09', versions)?.id).toBe('cur');
  });
  it('baseline rates for an existing deal are current (not future)', () => {
    const r = getProductCatalogBaselineVersioned(products, 'p1', 8, '2026-06-09', versions);
    expect(r).toMatchObject({ closerPerW: 2.9, kiloPerW: 2.4, pcPricingVersionId: 'cur' });
  });
  it('defensive: future open version excluded even if current not closed', () => {
    const bothOpen: ProductCatalogPricingVersion[] = [{ ...versions[0], effectiveTo: null }, versions[1]];
    expect(getActiveProductCatalogVersion('p1', '2026-06-09', bothOpen)?.id).toBe('cur');
  });
  it('future version wins on/after its effective date (sanity)', () => {
    expect(getActiveProductCatalogVersion('p1', '2026-06-18', versions)?.id).toBe('fut');
  });
});
