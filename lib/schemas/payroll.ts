import { z } from 'zod';
import { idSchema, optionalId, optionalString, finiteNumber } from '../api-validation';

/** Categories for standalone one-off charges. Single source of truth for
 *  both server validation and UI dropdown options. Free-text reason still
 *  lives in `notes`; this is the structured bucket for reporting.
 *  Add new values here when the operator vocabulary expands. */
export const CHARGE_CATEGORIES = [
  'equipment_damage',
  'reimbursement_clawback',
  'customer_dispute',
  'misc',
] as const;

export const CHARGE_CATEGORY_LABELS: Record<typeof CHARGE_CATEGORIES[number], string> = {
  equipment_damage: 'Equipment damage',
  reimbursement_clawback: 'Reimbursement clawback',
  customer_dispute: 'Customer dispute',
  misc: 'Misc',
};

/** Request body for POST /api/payroll.
 *
 *  `amount` allows negative values: chargebacks are stored as negative
 *  "Deal" PayrollEntry rows (matches the auto-generated shape from
 *  handleChargebacks), and admins sometimes post negative Bonus rows as
 *  post-window corrections. Capped to ±1M to catch fat-finger mistakes
 *  without blocking legitimate entries.
 *
 *  A chargeback (isChargeback=true) must carry context in one of three
 *  shapes:
 *    1. Linked clawback — `chargebackOfId` points at the Paid entry being
 *       clawed back (RecordChargebackModal on the project page). Service
 *       layer validates the parent is Paid + same project/rep/stage.
 *    2. Standalone charge — `chargeCategory` set, `chargebackOfId` null
 *       (one-off deduction with no parent, e.g. equipment damage).
 *    3. Project clawback — `projectId` set, no parent + no category. The
 *       manual "Chargeback" flow on the payroll page records a clawback
 *       against a known (typically cancelled) deal without linking a
 *       specific Paid PayrollEntry — e.g. the original was paid pre-app in
 *       Glide so there's no in-app row to point at.
 *  `chargebackOfId` and `chargeCategory` remain mutually exclusive — a row
 *  is never both a linked clawback and a standalone charge.
 */
export const createPayrollSchema = z.object({
  repId: idSchema,
  projectId: optionalId,
  amount: finiteNumber.min(-1_000_000).max(1_000_000),
  type: z.string().min(1),
  paymentStage: z.string().min(1),
  status: z.enum(['Draft', 'Pending', 'Paid']).optional().default('Draft'),
  date: z.string().min(1),                // ISO date string
  notes: optionalString.default(''),
  idempotencyKey: z.string().min(1).max(200).optional().nullable(),
  /** Chargeback tracking — for a linked clawback, both must be set together
   *  (isChargeback=true, chargebackOfId pointing at the Paid entry being
   *  clawed back). The service layer enforces that chargebackOfId
   *  references a Paid entry on the same project+rep+stage and that
   *  |amount| ≤ original.
   *
   *  For a standalone charge, isChargeback=true + chargebackOfId=null +
   *  chargeCategory set. Service layer skips the parent-existence checks. */
  isChargeback: z.boolean().optional().default(false),
  chargebackOfId: optionalId,
  /** Standalone one-off charge category. When set, signals this is NOT a
   *  clawback of a specific paid entry. Mutually exclusive with chargebackOfId. */
  chargeCategory: z.enum(CHARGE_CATEGORIES).nullish(),
}).refine(
  // A chargeback must carry context: a parent Paid entry (linked clawback),
  // a charge category (standalone charge), or at least a project (manual
  // project-scoped clawback from the payroll page). A fully contextless
  // chargeback — no parent, no category, no project — is rejected.
  (d) => !d.isChargeback || d.chargebackOfId != null || d.chargeCategory != null || d.projectId != null,
  { message: 'chargeback requires a chargebackOfId (linked), chargeCategory (standalone), or projectId (project clawback)', path: ['chargebackOfId'] },
).refine(
  // Mutually exclusive — a row is one or the other.
  (d) => !(d.chargebackOfId != null && d.chargeCategory != null),
  { message: 'chargebackOfId and chargeCategory cannot both be set', path: ['chargeCategory'] },
).refine(
  (d) => !d.isChargeback || d.amount < 0,
  { message: 'chargeback amount must be negative', path: ['amount'] },
).refine(
  // Standalone charge amount is also constrained negative (caught by the
  // chargeback rule above when isChargeback=true, but enforce regardless
  // in case a caller sets chargeCategory without isChargeback).
  (d) => d.chargeCategory == null || d.amount < 0,
  { message: 'standalone charge amount must be negative', path: ['amount'] },
);
export type CreatePayrollInput = z.infer<typeof createPayrollSchema>;

/** Request body for PATCH /api/payroll — bulk status transition */
export const patchPayrollSchema = z.object({
  ids: z.array(idSchema).min(1).max(500),
  status: z.enum(['Pending', 'Paid']),
});
export type PatchPayrollInput = z.infer<typeof patchPayrollSchema>;
