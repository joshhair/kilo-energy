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
  /** Effective date for the initial pricing version. Defaults to today.
   *  Admin can pick a future date so the product is created now but
   *  doesn't apply to deals until that date arrives — perfect for
   *  pre-staging next-quarter pricing. Past dates are blocked at the
   *  endpoint level (would silently rewrite paid commission). */
  effectiveFrom: z.string().min(1).max(20).optional(),
  /** Initial pricing version label. Defaults to 'v1'. */
  versionLabel: z.string().min(1).max(50).optional(),
  /** Idempotency key to prevent accidental double-creates from
   *  duplicate clicks. Server dedupes within a 60s window. */
  idempotencyKey: z.string().max(100).optional(),
  /** Optional admin note: why this product is being created. Stored
   *  on the AuditLog entry; useful for forensic review. */
  reason: z.string().max(500).optional(),
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

/**
 * Per-installer handoff email configuration (BVI Solar + future installers).
 * Drives the auto-email of the installer-specific intake PDF + utility
 * bill at deal submission time. All fields optional so PATCH can update
 * any subset.
 *
 * Email validation is intentionally lenient at the Zod boundary (just
 * length + string shape) — the route handler runs each email through
 * `validateEmail()` from `lib/validation.ts` for NFC + invisible-char
 * rejection before persisting.
 */
export const patchInstallerHandoffConfigSchema = z.object({
  primaryEmail: z.string().max(254).nullable().optional(),
  ccEmails: z.array(z.string().max(254)).max(20).optional(),
  subjectPrefix: z.string().max(40).nullable().optional(),
  handoffEnabled: z.boolean().optional(),
  customNotes: z.string().max(2000).optional(),
}).strict();
export type PatchInstallerHandoffConfigInput = z.infer<typeof patchInstallerHandoffConfigSchema>;

/**
 * StalledAlertConfig — admin singleton powering the daily digest. All
 * fields optional so PATCH can update any subset. phaseThresholds is a
 * map of { phaseName: thresholdDays }; phases not present fall back to
 * defaults at digest-compute time.
 */
export const patchStalledConfigSchema = z.object({
  enabled: z.boolean().optional(),
  soldDateCutoffDays: z.number().int().min(1).max(3650).optional(),
  digestRecipients: z.array(z.string().max(254)).max(50).optional(),
  phaseThresholds: z.record(z.string(), z.number().int().min(1).max(3650)).optional(),
  digestSendHourUtc: z.number().int().min(0).max(23).optional(),
}).strict();
export type PatchStalledConfigInput = z.infer<typeof patchStalledConfigSchema>;

// ─── Project survey-links + installer-notes (BVI handoff) ─────────────────

/**
 * URL must be HTTPS-prefixed (rejects http:// to prevent mixed-content
 * + reduces phishing surface) and within a sane length cap.
 */
const httpsUrl = z.string().min(1).max(2000).refine(
  (v) => /^https:\/\//i.test(v.trim()),
  { message: 'URL must use https://' },
);

export const createProjectSurveyLinkSchema = z.object({
  url: httpsUrl,
  label: z.string().min(1).max(200),
}).strict();
export type CreateProjectSurveyLinkInput = z.infer<typeof createProjectSurveyLinkSchema>;

export const patchProjectSurveyLinkSchema = z.object({
  url: httpsUrl.optional(),
  label: z.string().min(1).max(200).optional(),
}).strict();
export type PatchProjectSurveyLinkInput = z.infer<typeof patchProjectSurveyLinkSchema>;

export const createProjectInstallerNoteSchema = z.object({
  body: z.string().min(1).max(5000),
}).strict();
export type CreateProjectInstallerNoteInput = z.infer<typeof createProjectInstallerNoteSchema>;

export const patchProjectInstallerNoteSchema = z.object({
  body: z.string().min(1).max(5000),
}).strict();
export type PatchProjectInstallerNoteInput = z.infer<typeof patchProjectInstallerNoteSchema>;

// ─── Single-entry payroll patch ─────────────────────────────────────────────

export const patchPayrollEntrySchema = z.object({
  status: z.enum(['Draft', 'Pending', 'Paid']).optional(),
  amount: finiteNumber.optional(),
  date: z.string().min(1).optional(),
  notes: z.string().max(2000).optional(),
}).strict();
export type PatchPayrollEntryInput = z.infer<typeof patchPayrollEntrySchema>;

