import { z } from 'zod';
import { idSchema, moneyAmount, optionalString } from '../api-validation';

export const createReimbursementSchema = z.object({
  repId: idSchema,
  amount: moneyAmount.max(100_000, 'reimbursement amount exceeds sanity cap'),
  description: z.string().min(1).max(2000),
  date: z.string().min(1),             // ISO date
  receiptName: optionalString,
  receiptUrl: optionalString,           // Vercel Blob public URL (set by /receipt upload endpoint)
});
export type CreateReimbursementInput = z.infer<typeof createReimbursementSchema>;

export const patchReimbursementSchema = z.object({
  status: z.enum(['Pending', 'Approved', 'Denied', 'Paid']).optional(),
  // Soft-archive toggle. true = archivedAt: now(), false = archivedAt: null.
  // Separate from status so archive can be toggled independently of approval.
  archived: z.boolean().optional(),
  // Allow rep to attach a receipt URL after upload (server-side receiptUrl
  // write happens in the /receipt endpoint, this keeps the shape permissive
  // for admin edits if needed).
  receiptUrl: optionalString.nullable(),
  receiptName: optionalString.nullable(),
}).strict();
export type PatchReimbursementInput = z.infer<typeof patchReimbursementSchema>;
