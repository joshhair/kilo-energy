import { z } from 'zod';
import { idSchema, finiteNumber, pricePerWatt } from '../api-validation';

const positiveKw = finiteNumber.min(0).max(1000);

const pricingTierSchema = z.object({
  minKW: positiveKw.optional().default(0),
  maxKW: positiveKw.nullable().optional(),
  closerPerW: pricePerWatt,
  setterPerW: pricePerWatt.nullable().optional(),
  kiloPerW: pricePerWatt,
  subDealerPerW: pricePerWatt.nullable().optional(),
});

// ─── Installer pricing ──────────────────────────────────────────────────────

export const createInstallerPricingSchema = z.object({
  installerId: idSchema,
  label: z.string().min(1).max(50),
  effectiveFrom: z.string().min(1),
  effectiveTo: z.string().nullable().optional(),
  rateType: z.enum(['flat', 'tiered']).optional().default('flat'),
  tiers: z.array(pricingTierSchema).max(20).default([]),
  closePreviousForInstaller: z.boolean().optional().default(false),
  closePreviousEffectiveTo: z.string().optional(),
});
export type CreateInstallerPricingInput = z.infer<typeof createInstallerPricingSchema>;

export const patchInstallerPricingSchema = z.object({
  effectiveTo: z.string().nullable().optional(),
  label: z.string().min(1).max(50).optional(),
  tiers: z.array(pricingTierSchema).max(20).optional(),
}).strict();
export type PatchInstallerPricingInput = z.infer<typeof patchInstallerPricingSchema>;

// ─── Product pricing ────────────────────────────────────────────────────────

const productPricingTierSchema = pricingTierSchema.extend({
  // For product pricing, setterPerW is required (vs. installer pricing where it's optional)
  setterPerW: pricePerWatt,
});

export const createProductPricingSchema = z.object({
  productId: idSchema,
  label: z.string().min(1).max(50),
  effectiveFrom: z.string().min(1),
  effectiveTo: z.string().nullable().optional(),
  closePreviousEffectiveTo: z.string().optional(),
  tiers: z.array(productPricingTierSchema).max(20).default([]),
});
export type CreateProductPricingInput = z.infer<typeof createProductPricingSchema>;

// ─── Products ───────────────────────────────────────────────────────────────

export const createProductSchema = z.object({
  installerId: idSchema,
  family: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  tiers: z.array(productPricingTierSchema).max(20).optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const patchProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  family: z.string().min(1).max(100).optional(),
  tiers: z.array(productPricingTierSchema).max(20).optional(),
}).strict();
export type PatchProductInput = z.infer<typeof patchProductSchema>;

// ─── Installers ─────────────────────────────────────────────────────────────

export const createInstallerSchema = z.object({
  name: z.string().min(1).max(100),
  installPayPct: z.number().int().min(0).max(100).optional().default(80),
  usesProductCatalog: z.boolean().optional().default(false),
  closerPerW: pricePerWatt.optional(),
  kiloPerW: pricePerWatt.optional(),
  families: z.array(z.string().min(1).max(100)).max(20).optional(),
  familyFinancerMap: z.record(z.string(), z.string()).optional(),
  prepaidFamily: z.string().nullable().optional(),
});
export type CreateInstallerInput = z.infer<typeof createInstallerSchema>;

export const patchInstallerSchema = z.object({
  active: z.boolean().optional(),
  installPayPct: z.number().int().min(0).max(100).optional(),
  name: z.string().min(1).max(100).optional(),
}).strict();
export type PatchInstallerInput = z.infer<typeof patchInstallerSchema>;

export const patchInstallerConfigSchema = z.object({
  families: z.array(z.string().min(1).max(100)).max(20).optional(),
  familyFinancerMap: z.record(z.string(), z.string()).optional(),
  prepaidFamily: z.string().nullable().optional(),
}).strict();
export type PatchInstallerConfigInput = z.infer<typeof patchInstallerConfigSchema>;

// ─── Single-entry payroll patch ─────────────────────────────────────────────

export const patchPayrollEntrySchema = z.object({
  status: z.enum(['Draft', 'Pending', 'Paid']).optional(),
  amount: finiteNumber.optional(),
  date: z.string().min(1).optional(),
  notes: z.string().max(2000).optional(),
}).strict();
export type PatchPayrollEntryInput = z.infer<typeof patchPayrollEntrySchema>;

