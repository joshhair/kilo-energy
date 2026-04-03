import { describe, it, expect } from 'vitest';
import {
  calculateCommission,
  getBaselineRate,
  getSolarTechBaseline,
  getNonSolarTechBaseline,
  getTrainerOverrideRate,
  getInstallerRatesForDeal,
  getActiveInstallerVersion,
  getProductCatalogBaseline,
  getProductCatalogBaselineVersioned,
  getActiveProductCatalogVersion,
  makeProductCatalogTiers,
  SOLARTECH_PRODUCTS,
  INSTALLER_PRICING_VERSIONS,
  NON_SOLARTECH_BASELINES,
  BASELINE_RATES,
  INSTALLER_PAY_CONFIGS,
  DEFAULT_INSTALL_PAY_PCT,
  type TrainerAssignment,
  type InstallerPricingVersion,
  type ProductCatalogProduct,
  type ProductCatalogPricingVersion,
} from '@/lib/data';

// ─── calculateCommission ────────────────────────────────────────────────────

describe('calculateCommission', () => {
  it('computes (soldPPW - baseline) × kW × 1000', () => {
    // 3.55 - 3.10 = 0.45 × 8.4 × 1000 = 3780
    expect(calculateCommission(3.55, 3.10, 8.4)).toBe(3780);
  });

  it('returns 0 when soldPPW is below baseline (no negative commissions)', () => {
    expect(calculateCommission(2.50, 3.00, 10)).toBe(0);
  });

  it('returns 0 when soldPPW equals baseline', () => {
    expect(calculateCommission(3.00, 3.00, 8)).toBe(0);
  });

  it('handles fractional kW sizes', () => {
    // 3.00 - 2.90 = 0.10 × 6.6 × 1000 = 660
    expect(calculateCommission(3.00, 2.90, 6.6)).toBe(660);
  });

  it('handles large systems', () => {
    // 3.50 - 2.85 = 0.65 × 25 × 1000 = 16250
    expect(calculateCommission(3.50, 2.85, 25)).toBe(16250);
  });

  it('handles very small margins', () => {
    // 2.91 - 2.90 = 0.01 × 10 × 1000 = 100
    expect(calculateCommission(2.91, 2.90, 10)).toBe(100);
  });
});

// ─── getBaselineRate (generic financer+productType+kW lookup) ───────────────

describe('getBaselineRate', () => {
  it('finds exact match for Goodleap/Loan at 8.4 kW (5–10 tier)', () => {
    const rate = getBaselineRate('Goodleap', 'Loan', 8.4);
    expect(rate.closerPerW).toBe(3.10);
    expect(rate.kiloPerW).toBe(2.50);
  });

  it('finds match at tier boundary (kW == tierMinKW)', () => {
    const rate = getBaselineRate('Goodleap', 'Loan', 5);
    expect(rate.closerPerW).toBe(3.10); // 5–10 tier
  });

  it('finds match at bottom of first tier', () => {
    const rate = getBaselineRate('Goodleap', 'Loan', 1);
    expect(rate.closerPerW).toBe(3.45); // 1–5 tier
  });

  it('finds match in unbounded top tier (kW >= 13)', () => {
    const rate = getBaselineRate('Goodleap', 'Loan', 20);
    expect(rate.closerPerW).toBe(2.85);
    expect(rate.kiloPerW).toBe(2.35);
  });

  it('falls back by product type if financer not found', () => {
    const rate = getBaselineRate('UnknownFinancer', 'Loan', 8);
    // Should find the first Loan entry in BASELINE_RATES
    expect(rate.closerPerW).toBeGreaterThan(0);
  });

  it('returns default 3.00/2.45 if nothing matches', () => {
    const rate = getBaselineRate('NoFinancer', 'NoProduct', 8);
    expect(rate.closerPerW).toBe(3.00);
    expect(rate.kiloPerW).toBe(2.45);
  });

  it('matches Sunrun/PPA tiers correctly', () => {
    const small = getBaselineRate('Sunrun', 'PPA', 3);
    expect(small.closerPerW).toBe(3.60);
    const mid = getBaselineRate('Sunrun', 'PPA', 7);
    expect(mid.closerPerW).toBe(3.30);
    const large = getBaselineRate('Sunrun', 'PPA', 15);
    expect(large.closerPerW).toBe(3.10);
  });

  it('matches Cash/Cash tiers correctly', () => {
    const small = getBaselineRate('Cash', 'Cash', 3);
    expect(small.closerPerW).toBe(3.10);
    const large = getBaselineRate('Cash', 'Cash', 8);
    expect(large.closerPerW).toBe(2.75);
  });
});

// ─── getSolarTechBaseline ───────────────────────────────────────────────────

describe('getSolarTechBaseline', () => {
  it('returns correct rates for Goodleap Q.Peak DUO at 8 kW (5–10 tier)', () => {
    const rate = getSolarTechBaseline('gl-qpeak-enphase', 8);
    expect(rate.closerPerW).toBe(3.10);
    expect(rate.setterPerW).toBe(3.20); // closer + 0.10
    expect(rate.kiloPerW).toBe(2.50);
  });

  it('returns correct rates for small system (1–5 tier)', () => {
    const rate = getSolarTechBaseline('gl-qpeak-enphase', 3);
    expect(rate.closerPerW).toBe(3.45);
    expect(rate.setterPerW).toBe(3.55);
    expect(rate.kiloPerW).toBe(2.90);
  });

  it('returns correct rates for large system (13+ tier)', () => {
    const rate = getSolarTechBaseline('gl-qpeak-enphase', 15);
    expect(rate.closerPerW).toBe(2.85);
    expect(rate.kiloPerW).toBe(2.35);
  });

  it('returns zeros for unknown product', () => {
    const rate = getSolarTechBaseline('nonexistent', 8);
    expect(rate.closerPerW).toBe(0);
    expect(rate.setterPerW).toBe(0);
    expect(rate.kiloPerW).toBe(0);
  });

  it('setter baseline is always closer + $0.10', () => {
    for (const product of SOLARTECH_PRODUCTS) {
      for (const tier of product.tiers) {
        const expected = Math.round((tier.closerPerW + 0.10) * 100) / 100;
        expect(tier.setterPerW).toBe(expected);
      }
    }
  });

  it('handles battery products (higher prices)', () => {
    // Q.TRON + 3x PW3 at 1–5 kW tier
    const rate = getSolarTechBaseline('gl-qtron-3pw3', 3);
    expect(rate.closerPerW).toBe(10.58);
    expect(rate.kiloPerW).toBe(10.03);
  });

  it('has expected SolarTech products', () => {
    expect(SOLARTECH_PRODUCTS.length).toBeGreaterThanOrEqual(24);
  });

  it('each product has 4 kW tiers', () => {
    for (const product of SOLARTECH_PRODUCTS) {
      expect(product.tiers).toHaveLength(4);
    }
  });

  it('sub-dealer rates are kilo + 0.30 offset', () => {
    for (const product of SOLARTECH_PRODUCTS) {
      for (const tier of product.tiers) {
        if (tier.subDealerPerW != null) {
          const expected = Math.round((tier.kiloPerW + 0.30) * 100) / 100;
          expect(tier.subDealerPerW).toBe(expected);
        }
      }
    }
  });
});

// ─── getNonSolarTechBaseline ────────────────────────────────────────────────

describe('getNonSolarTechBaseline', () => {
  it('returns ESP rates', () => {
    const b = getNonSolarTechBaseline('ESP');
    expect(b.closerPerW).toBe(2.90);
    expect(b.kiloPerW).toBe(2.35);
  });

  it('returns GEG rates (different from default)', () => {
    const b = getNonSolarTechBaseline('GEG');
    expect(b.closerPerW).toBe(2.70);
    expect(b.kiloPerW).toBe(2.15);
  });

  it('returns SunPower rates (lowest baselines)', () => {
    const b = getNonSolarTechBaseline('SunPower');
    expect(b.closerPerW).toBe(2.00);
    expect(b.kiloPerW).toBe(1.50);
  });

  it('returns default fallback for unknown installer', () => {
    const b = getNonSolarTechBaseline('UnknownInstaller');
    expect(b.closerPerW).toBe(2.90);
    expect(b.kiloPerW).toBe(2.35);
  });

  it('all 11 non-SolarTech installers have baselines', () => {
    const expected = ['ESP', 'EXO', 'GEG', 'SunPower', 'Complete Solar', 'Solrite', 'Solnova', 'EXO (OLD)', 'Bryton', 'One Source', 'Pacific Coast'];
    for (const name of expected) {
      expect(NON_SOLARTECH_BASELINES[name]).toBeDefined();
    }
  });
});

// ─── getTrainerOverrideRate ─────────────────────────────────────────────────

describe('getTrainerOverrideRate', () => {
  const assignment: TrainerAssignment = {
    id: 'ta-test',
    trainerId: 'trainer1',
    traineeId: 'trainee1',
    tiers: [
      { upToDeal: 10, ratePerW: 0.20 },
      { upToDeal: 25, ratePerW: 0.10 },
      { upToDeal: null, ratePerW: 0.05 },
    ],
  };

  it('returns highest rate for first deals (< 10)', () => {
    expect(getTrainerOverrideRate(assignment, 0)).toBe(0.20);
    expect(getTrainerOverrideRate(assignment, 5)).toBe(0.20);
    expect(getTrainerOverrideRate(assignment, 9)).toBe(0.20);
  });

  it('returns mid rate for deals 10–24', () => {
    expect(getTrainerOverrideRate(assignment, 10)).toBe(0.10);
    expect(getTrainerOverrideRate(assignment, 15)).toBe(0.10);
    expect(getTrainerOverrideRate(assignment, 24)).toBe(0.10);
  });

  it('returns lowest rate for deals 25+', () => {
    expect(getTrainerOverrideRate(assignment, 25)).toBe(0.05);
    expect(getTrainerOverrideRate(assignment, 100)).toBe(0.05);
  });

  it('handles two-tier assignment', () => {
    const twoTier: TrainerAssignment = {
      id: 'ta-2',
      trainerId: 't1',
      traineeId: 't2',
      tiers: [
        { upToDeal: 10, ratePerW: 0.20 },
        { upToDeal: null, ratePerW: 0.10 },
      ],
    };
    expect(getTrainerOverrideRate(twoTier, 5)).toBe(0.20);
    expect(getTrainerOverrideRate(twoTier, 10)).toBe(0.10);
    expect(getTrainerOverrideRate(twoTier, 50)).toBe(0.10);
  });

  it('returns 0 for empty tiers', () => {
    const empty: TrainerAssignment = {
      id: 'ta-empty',
      trainerId: 't1',
      traineeId: 't2',
      tiers: [],
    };
    expect(getTrainerOverrideRate(empty, 5)).toBe(0);
  });
});

// ─── Installer Pricing Version System ───────────────────────────────────────

describe('getActiveInstallerVersion', () => {
  it('finds current active version for ESP', () => {
    const v = getActiveInstallerVersion('ESP', '2026-03-15', INSTALLER_PRICING_VERSIONS);
    expect(v).not.toBeNull();
    expect(v!.installer).toBe('ESP');
    expect(v!.rates).toEqual({ type: 'flat', closerPerW: 2.90, kiloPerW: 2.35 });
  });

  it('returns null for date before any version', () => {
    const v = getActiveInstallerVersion('ESP', '2019-01-01', INSTALLER_PRICING_VERSIONS);
    expect(v).toBeNull();
  });

  it('returns null for unknown installer', () => {
    const v = getActiveInstallerVersion('FakeInstaller', '2026-01-01', INSTALLER_PRICING_VERSIONS);
    expect(v).toBeNull();
  });

  it('picks most recent effectiveFrom when multiple overlap', () => {
    const versions: InstallerPricingVersion[] = [
      { id: 'v1', installer: 'TestCo', label: 'v1', effectiveFrom: '2024-01-01', effectiveTo: null, rates: { type: 'flat', closerPerW: 2.00, kiloPerW: 1.50 } },
      { id: 'v2', installer: 'TestCo', label: 'v2', effectiveFrom: '2025-06-01', effectiveTo: null, rates: { type: 'flat', closerPerW: 2.50, kiloPerW: 2.00 } },
    ];
    const v = getActiveInstallerVersion('TestCo', '2026-01-01', versions);
    expect(v!.id).toBe('v2');
  });

  it('respects effectiveTo boundary', () => {
    const versions: InstallerPricingVersion[] = [
      { id: 'v1', installer: 'TestCo', label: 'v1', effectiveFrom: '2024-01-01', effectiveTo: '2025-05-31', rates: { type: 'flat', closerPerW: 2.00, kiloPerW: 1.50 } },
      { id: 'v2', installer: 'TestCo', label: 'v2', effectiveFrom: '2025-06-01', effectiveTo: null, rates: { type: 'flat', closerPerW: 2.50, kiloPerW: 2.00 } },
    ];
    const v1 = getActiveInstallerVersion('TestCo', '2025-03-01', versions);
    expect(v1!.id).toBe('v1');
    const v2 = getActiveInstallerVersion('TestCo', '2025-07-01', versions);
    expect(v2!.id).toBe('v2');
  });
});

describe('getInstallerRatesForDeal', () => {
  it('returns flat rates from active version', () => {
    const r = getInstallerRatesForDeal('ESP', '2026-01-01', 8, INSTALLER_PRICING_VERSIONS);
    expect(r.closerPerW).toBe(2.90);
    expect(r.setterPerW).toBe(3.00); // auto: closer + 0.10
    expect(r.kiloPerW).toBe(2.35);
    expect(r.versionId).toBe('ipv_esp_v1');
  });

  it('falls back to NON_SOLARTECH_BASELINES when no version found', () => {
    const r = getInstallerRatesForDeal('ESP', '2019-01-01', 8, INSTALLER_PRICING_VERSIONS);
    expect(r.closerPerW).toBe(2.90);
    expect(r.versionId).toBeNull();
  });

  it('handles tiered rate versions', () => {
    const versions: InstallerPricingVersion[] = [{
      id: 'tiered-v1',
      installer: 'TieredCo',
      label: 'v1',
      effectiveFrom: '2024-01-01',
      effectiveTo: null,
      rates: {
        type: 'tiered',
        bands: [
          { minKW: 1, maxKW: 10, closerPerW: 3.00, kiloPerW: 2.50 },
          { minKW: 10, maxKW: null, closerPerW: 2.80, kiloPerW: 2.30 },
        ],
      },
    }];
    const small = getInstallerRatesForDeal('TieredCo', '2025-01-01', 5, versions);
    expect(small.closerPerW).toBe(3.00);
    expect(small.setterPerW).toBe(3.10);
    const large = getInstallerRatesForDeal('TieredCo', '2025-01-01', 12, versions);
    expect(large.closerPerW).toBe(2.80);
  });
});

// ─── Product Catalog System ─────────────────────────────────────────────────

describe('getProductCatalogBaseline', () => {
  const products: ProductCatalogProduct[] = [{
    id: 'pc-test-1',
    installer: 'TestInstaller',
    family: 'TestFamily',
    name: 'Test Product',
    tiers: makeProductCatalogTiers([3.00, 2.80, 2.60, 2.50], [2.50, 2.30, 2.10, 2.00]),
  }];

  it('finds correct tier for small system', () => {
    const r = getProductCatalogBaseline(products, 'pc-test-1', 3);
    expect(r.closerPerW).toBe(3.00);
    expect(r.setterPerW).toBe(3.10);
    expect(r.kiloPerW).toBe(2.50);
  });

  it('finds correct tier for mid system', () => {
    const r = getProductCatalogBaseline(products, 'pc-test-1', 7);
    expect(r.closerPerW).toBe(2.80);
  });

  it('finds correct tier for large system', () => {
    const r = getProductCatalogBaseline(products, 'pc-test-1', 15);
    expect(r.closerPerW).toBe(2.50);
  });

  it('returns zeros for unknown product', () => {
    const r = getProductCatalogBaseline(products, 'nonexistent', 8);
    expect(r.closerPerW).toBe(0);
  });
});

describe('getProductCatalogBaselineVersioned', () => {
  const products: ProductCatalogProduct[] = [{
    id: 'pc-v-1',
    installer: 'VInst',
    family: 'VFam',
    name: 'Versioned Product',
    tiers: makeProductCatalogTiers([3.00, 2.80, 2.60, 2.50], [2.50, 2.30, 2.10, 2.00]),
  }];

  const versions: ProductCatalogPricingVersion[] = [{
    id: 'pcv-1',
    productId: 'pc-v-1',
    label: 'v2',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    tiers: makeProductCatalogTiers([3.50, 3.30, 3.10, 3.00], [3.00, 2.80, 2.60, 2.50]),
  }];

  it('uses versioned rates when version exists for date', () => {
    const r = getProductCatalogBaselineVersioned(products, 'pc-v-1', 7, '2026-03-01', versions);
    expect(r.closerPerW).toBe(3.30); // from version, not product base
    expect(r.pcPricingVersionId).toBe('pcv-1');
  });

  it('falls back to product tiers when no version covers date', () => {
    const r = getProductCatalogBaselineVersioned(products, 'pc-v-1', 7, '2025-06-01', versions);
    expect(r.closerPerW).toBe(2.80); // from product base
    expect(r.pcPricingVersionId).toBeNull();
  });
});

describe('getActiveProductCatalogVersion', () => {
  const versions: ProductCatalogPricingVersion[] = [
    { id: 'pcv-a', productId: 'p1', label: 'v1', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', tiers: [] },
    { id: 'pcv-b', productId: 'p1', label: 'v2', effectiveFrom: '2026-01-01', effectiveTo: null, tiers: [] },
  ];

  it('finds version by date', () => {
    expect(getActiveProductCatalogVersion('p1', '2025-06-01', versions)?.id).toBe('pcv-a');
    expect(getActiveProductCatalogVersion('p1', '2026-06-01', versions)?.id).toBe('pcv-b');
  });

  it('returns null for unknown product', () => {
    expect(getActiveProductCatalogVersion('unknown', '2026-01-01', versions)).toBeNull();
  });
});

// ─── Installer Pay Config ───────────────────────────────────────────────────

describe('Installer Pay Configs', () => {
  it('SolarTech pays 100% at install (no M3)', () => {
    expect(INSTALLER_PAY_CONFIGS['SolarTech'].installPayPct).toBe(100);
  });

  it('most installers pay 80% at install (20% at PTO)', () => {
    for (const name of ['ESP', 'EXO', 'GEG', 'SunPower', 'Complete Solar', 'Solrite', 'Solnova', 'Bryton', 'One Source', 'Pacific Coast']) {
      expect(INSTALLER_PAY_CONFIGS[name].installPayPct).toBe(80);
    }
  });

  it('default install pay pct is 80', () => {
    expect(DEFAULT_INSTALL_PAY_PCT).toBe(80);
  });
});

// ─── Data Integrity ─────────────────────────────────────────────────────────

describe('Data integrity', () => {
  it('all BASELINE_RATES have valid tiers (min < max or max is null)', () => {
    for (const rate of BASELINE_RATES) {
      if (rate.tierMaxKW !== null) {
        expect(rate.tierMinKW).toBeLessThan(rate.tierMaxKW);
      }
      expect(rate.closerPerW).toBeGreaterThan(0);
      expect(rate.kiloPerW).toBeGreaterThan(0);
    }
  });

  it('all INSTALLER_PRICING_VERSIONS have valid date ranges', () => {
    for (const v of INSTALLER_PRICING_VERSIONS) {
      expect(v.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (v.effectiveTo) {
        expect(v.effectiveTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(v.effectiveTo >= v.effectiveFrom).toBe(true);
      }
    }
  });

  it('SolarTech products have decreasing prices as kW increases', () => {
    for (const product of SOLARTECH_PRODUCTS) {
      for (let i = 0; i < product.tiers.length - 1; i++) {
        expect(product.tiers[i].closerPerW).toBeGreaterThanOrEqual(product.tiers[i + 1].closerPerW);
      }
    }
  });
});
