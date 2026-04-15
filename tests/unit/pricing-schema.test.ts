import { describe, it, expect } from 'vitest';
import {
  createInstallerPricingSchema,
  patchInstallerPricingSchema,
  createProductPricingSchema,
  createProductSchema,
  patchProductSchema,
  createInstallerSchema,
  patchInstallerSchema,
  patchInstallerConfigSchema,
  patchPayrollEntrySchema,
} from '@/lib/schemas/pricing';

const baseTier = { minKW: 0, maxKW: 5, closerPerW: 2.9, kiloPerW: 2.35 };
const productTier = { ...baseTier, setterPerW: 3.0 };

describe('createInstallerPricingSchema', () => {
  it('accepts minimal valid input with defaults', () => {
    const r = createInstallerPricingSchema.safeParse({
      installerId: 'inst_1',
      label: 'v1',
      effectiveFrom: '2026-01-01',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.rateType).toBe('flat');
      expect(r.data.tiers).toEqual([]);
    }
  });

  it('accepts a tiered version with rates', () => {
    const r = createInstallerPricingSchema.safeParse({
      installerId: 'inst_1',
      label: 'v2',
      effectiveFrom: '2026-04-01',
      rateType: 'tiered',
      tiers: [baseTier],
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid rateType', () => {
    const r = createInstallerPricingSchema.safeParse({
      installerId: 'inst_1',
      label: 'v1',
      effectiveFrom: '2026-01-01',
      rateType: 'percent',
    });
    expect(r.success).toBe(false);
  });

  it('rejects negative price/W', () => {
    const r = createInstallerPricingSchema.safeParse({
      installerId: 'inst_1',
      label: 'v1',
      effectiveFrom: '2026-01-01',
      tiers: [{ ...baseTier, closerPerW: -1 }],
    });
    expect(r.success).toBe(false);
  });

  it('caps price/W at sanity bound', () => {
    const r = createInstallerPricingSchema.safeParse({
      installerId: 'inst_1',
      label: 'v1',
      effectiveFrom: '2026-01-01',
      tiers: [{ ...baseTier, closerPerW: 100 }],
    });
    expect(r.success).toBe(false);
  });
});

describe('patchInstallerPricingSchema', () => {
  it('accepts partial updates', () => {
    expect(patchInstallerPricingSchema.safeParse({ label: 'v3' }).success).toBe(true);
    expect(patchInstallerPricingSchema.safeParse({ effectiveTo: '2026-12-31' }).success).toBe(true);
    expect(patchInstallerPricingSchema.safeParse({ tiers: [baseTier] }).success).toBe(true);
  });

  it('rejects unknown fields (strict)', () => {
    const r = patchInstallerPricingSchema.safeParse({ label: 'v3', evil: 'inject' });
    expect(r.success).toBe(false);
  });
});

describe('createProductPricingSchema', () => {
  it('requires setterPerW on product tiers', () => {
    const r = createProductPricingSchema.safeParse({
      productId: 'prod_1',
      label: 'v1',
      effectiveFrom: '2026-01-01',
      tiers: [baseTier],  // missing setterPerW
    });
    expect(r.success).toBe(false);
  });

  it('accepts product tiers with setterPerW', () => {
    const r = createProductPricingSchema.safeParse({
      productId: 'prod_1',
      label: 'v1',
      effectiveFrom: '2026-01-01',
      tiers: [productTier],
    });
    expect(r.success).toBe(true);
  });
});

describe('createProductSchema', () => {
  it('accepts product without tiers', () => {
    const r = createProductSchema.safeParse({ installerId: 'i', family: 'f', name: 'n' });
    expect(r.success).toBe(true);
  });

  it('rejects empty name', () => {
    const r = createProductSchema.safeParse({ installerId: 'i', family: 'f', name: '' });
    expect(r.success).toBe(false);
  });
});

describe('patchProductSchema', () => {
  it('rejects unknown fields (strict)', () => {
    const r = patchProductSchema.safeParse({ name: 'x', sneaky: true });
    expect(r.success).toBe(false);
  });
});

describe('createInstallerSchema', () => {
  it('defaults installPayPct to 80 and usesProductCatalog to false', () => {
    const r = createInstallerSchema.safeParse({ name: 'NewInstaller' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.installPayPct).toBe(80);
      expect(r.data.usesProductCatalog).toBe(false);
    }
  });

  it('rejects installPayPct out of 0-100', () => {
    expect(createInstallerSchema.safeParse({ name: 'x', installPayPct: 150 }).success).toBe(false);
    expect(createInstallerSchema.safeParse({ name: 'x', installPayPct: -1 }).success).toBe(false);
  });
});

describe('patchInstallerSchema', () => {
  it('strict — rejects unknown fields', () => {
    expect(patchInstallerSchema.safeParse({ active: false, installerId: 'evil' }).success).toBe(false);
  });
});

describe('patchInstallerConfigSchema', () => {
  it('strict — rejects unknown fields', () => {
    expect(patchInstallerConfigSchema.safeParse({ families: ['x'], extra: 'no' }).success).toBe(false);
  });
});

describe('patchPayrollEntrySchema', () => {
  it('accepts status-only update', () => {
    expect(patchPayrollEntrySchema.safeParse({ status: 'Paid' }).success).toBe(true);
  });

  it('strict — rejects unknown fields', () => {
    expect(patchPayrollEntrySchema.safeParse({ status: 'Paid', sneaky: 1 }).success).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(patchPayrollEntrySchema.safeParse({ status: 'Yolo' }).success).toBe(false);
  });
});
