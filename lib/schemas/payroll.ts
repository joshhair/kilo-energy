import { z } from 'zod';
import { idSchema, optionalId, optionalString, finiteNumber } from '../api-validation';

/** Request body for POST /api/payroll.
 *
 *  `amount` allows negative values: chargebacks are stored as negative
 *  "Deal" PayrollEntry rows (matches the auto-generated shape from
 *  handleChargebacks), and admins sometimes post negative Bonus rows as
 *  post-window corrections. Capped to ±1M to catch fat-finger mistakes
 *  without blocking legitimate entries.
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
});
export type CreatePayrollInput = z.infer<typeof createPayrollSchema>;

/** Request body for PATCH /api/payroll — bulk status transition */
export const patchPayrollSchema = z.object({
  ids: z.array(idSchema).min(1).max(500),
  status: z.enum(['Pending', 'Paid']),
});
export type PatchPayrollInput = z.infer<typeof patchPayrollSchema>;
