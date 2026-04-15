import { z } from 'zod';
import { idSchema, moneyAmount, optionalString } from '../api-validation';

export const createReimbursementSchema = z.object({
  repId: idSchema,
  amount: moneyAmount.max(100_000, 'reimbursement amount exceeds sanity cap'),
  description: z.string().min(1).max(2000),
  date: z.string().min(1),             // ISO date
  receiptName: optionalString,
});
export type CreateReimbursementInput = z.infer<typeof createReimbursementSchema>;

export const patchReimbursementSchema = z.object({
  status: z.enum(['Pending', 'Approved', 'Denied', 'Paid']),
}).strict();
export type PatchReimbursementInput = z.infer<typeof patchReimbursementSchema>;
