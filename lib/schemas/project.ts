import { z } from 'zod';
import { idSchema, optionalId, optionalString, finiteNumber, moneyAmount } from '../api-validation';

const phaseEnum = z.enum([
  'New',
  'Sold',
  'Accepted',
  'Install Scheduled',
  'Installed',
  'PTO',
  'Cancelled',
  'On Hold',
  'Cancellation Pending',
]);

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
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/** Partial patch schema for PATCH /api/projects/[id] — all fields optional. */
export const patchProjectSchema = z.object({
  phase: phaseEnum.optional(),
  notes: optionalString,
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
  closerId: optionalId,
  setterId: optionalId,
  soldDate: z.string().min(1).optional(),                 // ISO date

  // FK resolution via name (API resolves to installerId/financerId)
  installer: z.string().min(1).optional(),
  financer: z.string().min(1).optional(),
}).strict();
export type PatchProjectInput = z.infer<typeof patchProjectSchema>;
