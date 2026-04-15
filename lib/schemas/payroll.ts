import { z } from 'zod';
import { idSchema, optionalString, moneyAmount } from '../api-validation';

/** Request body for POST /api/payroll */
export const createPayrollSchema = z.object({
  repId: idSchema,
  projectId: idSchema.nullable().optional(),
  amount: moneyAmount,
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
