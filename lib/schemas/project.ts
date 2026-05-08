import { z } from 'zod';
import { idSchema, optionalId, nullableId, optionalString, finiteNumber, moneyAmount } from '../api-validation';

const phaseEnum = z.enum([
  'New',
  'Acceptance',
  'Site Survey',
  'Design',
  'Permitting',
  'Pending Install',
  'Installed',
  'PTO',
  'Completed',
  'Cancelled',
  'On Hold',
]);

/** One co-closer or co-setter entry — person + their per-milestone cut.
 *  The primary closer/setter stays on Project.closerId / Project.setterId
 *  with their amount on Project.m1AmountCents etc. */
const additionalPartySchema = z.object({
  userId: idSchema,
  m1Amount: moneyAmount.optional(),
  m2Amount: moneyAmount.optional(),
  m3Amount: moneyAmount.optional(),
  /// 1-indexed display order. If omitted, server assigns by array position.
  position: z.number().int().min(1).max(99).optional(),
});

/** Request body for POST /api/projects — create a new deal. */
export const createProjectSchema = z.object({
  customerName: z.string().min(1).max(200),
  closerId: idSchema,
  setterId: optionalId,
  subDealerId: optionalId,
  soldDate: z.string().min(1),
  installerId: idSchema,
  financerId: optionalId,            // Cash deals send "" or omit; auto-resolved server-side
  financer: z.string().optional(),   // legacy name fallback used by "Cash" auto-resolve
  productType: z.string().min(1),
  kWSize: finiteNumber.positive().max(1000),
  netPPW: finiteNumber.positive().max(10),
  phase: phaseEnum.optional().default('New'),

  // Milestone amounts — default 0 when absent.
  m1Amount: moneyAmount.optional(),
  m2Amount: moneyAmount.optional(),
  m3Amount: moneyAmount.optional(),
  setterM1Amount: moneyAmount.optional(),
  setterM2Amount: moneyAmount.optional(),
  setterM3Amount: moneyAmount.optional(),

  notes: optionalString,
  installerPricingVersionId: optionalId,
  productId: optionalId,
  productPricingVersionId: optionalId,
  baselineOverrideJson: optionalString,
  prepaidSubType: optionalString,
  leadSource: optionalString,
  blitzId: optionalId,

  /// Tag-team support: additional closers / setters beyond the primary,
  /// each with their own cut. Hard cap of 10 — a runaway client sending
  /// thousands of rows would blow up the createMany batch.
  additionalClosers: z.array(additionalPartySchema).max(10).optional(),
  additionalSetters: z.array(additionalPartySchema).max(10).optional(),

  /// Per-installer intake JSON. Shape depends on the installer (BVI vs
  /// future Lumio/Sunova/etc.) — typed at lib/installer-intakes/<slug>.ts.
  /// Stored as JSON string on Project.installerIntakeJson. Server doesn't
  /// validate the shape here (it would need per-installer dispatch); the
  /// PDF renderer + downstream consumers parse defensively via
  /// `parseBviIntake()` which falls back to EMPTY_BVI_INTAKE on bad data.
  /// Hard length cap to prevent abuse.
  ///
  /// String-or-omitted only. `null` is intentionally rejected — that was
  /// the symptom of the 2026-05-08 client bug (lib/context.tsx coerced
  /// undefined → null). A future null arriving here is a real regression
  /// we want to surface, not silently accept.
  installerIntakeJson: z.string().max(20000).optional(),
  /// When true and the installer has handoffEnabled=true, the deal-create
  /// route fires the installer handoff email immediately after persist.
  /// Set by the rep via the BVI intake panel's "Send to BVI on submit" toggle.
  /// Failure to send does NOT roll back the deal — the project is created
  /// regardless; the failure surfaces as a failed-status EmailDelivery row.
  requestHandoff: z.boolean().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/** Partial patch schema for PATCH /api/projects/[id] — all fields optional. */
export const patchProjectSchema = z.object({
  phase: phaseEnum.optional(),
  notes: optionalString,
  // Admin + PM only. Zod accepts the field; the PATCH handler enforces
  // the role check before writing and returns 403 if a non-admin/PM
  // includes it in the payload.
  adminNotes: optionalString,
  flagged: z.boolean().optional(),

  // Milestone money
  m1Paid: z.boolean().optional(),
  m1Amount: moneyAmount.optional(),
  m2Paid: z.boolean().optional(),
  m2Amount: moneyAmount.optional(),
  m3Amount: moneyAmount.optional(),
  m3Paid: z.boolean().optional(),
  setterM1Amount: moneyAmount.optional(),
  setterM2Amount: moneyAmount.optional(),
  setterM3Amount: moneyAmount.optional(),

  // Cancellation
  cancellationReason: optionalString,
  cancellationNotes: optionalString,

  // Overrides + sourcing
  baselineOverrideJson: optionalString,
  leadSource: optionalString,
  blitzId: optionalId,

  // Core deal shape (affects commission math)
  productType: z.string().min(1).optional(),
  kWSize: finiteNumber.positive().max(1000).optional(),  // kW bound — 1MW residential cap
  netPPW: finiteNumber.min(0).max(10).optional(),        // $/W sanity bound
  closerId: nullableId,
  setterId: nullableId,
  soldDate: z.string().min(1).optional(),                 // ISO date

  // FK resolution via name (API resolves to installerId/financerId)
  installer: z.string().min(1).optional(),
  financer: z.string().min(1).optional(),

  // Tag-team — full replace semantics. If sent, the API deletes any
  // existing ProjectCloser/ProjectSetter rows for the project and
  // inserts these. Omit to leave current rows untouched.
  additionalClosers: z.array(additionalPartySchema).max(10).optional(),
  additionalSetters: z.array(additionalPartySchema).max(10).optional(),

  // Per-project trainer override. Admin-only one-off attachment that bypasses
  // the rep-level TrainerAssignment chain. Send both together to set, both
  // null to clear.
  trainerId:   optionalId,
  trainerRate: finiteNumber.min(0).max(5).nullable().optional(),
  // Admin's "remove all trainers from this deal" flag. true suppresses the
  // chain-trainee visibility + chain commission for this project.
  noChainTrainer: z.boolean().optional(),
}).strict();
export type PatchProjectInput = z.infer<typeof patchProjectSchema>;
