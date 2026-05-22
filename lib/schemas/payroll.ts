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
 *  Standalone Charge entries: `chargeCategory` is non-null AND
 *  `chargebackOfId` is null. The two flags are mutually exclusive — a row
 *  is either a clawback of a specific Paid entry (chargebackOfId set) or
 *  a standalone one-off charge (chargeCategory set), never both.
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
  // Chargebacks must have EITHER a parent (linked) OR a category (standalone),
  // never neither.
  (d) => !d.isChargeback || d.chargebackOfId != null || d.chargeCategory != null,
  { message: 'chargeback requires either chargebackOfId (linked) or chargeCategory (standalone)', path: ['chargebackOfId'] },
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
