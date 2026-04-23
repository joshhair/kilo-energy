import { z } from 'zod';

const repTypeEnum = z.enum(['closer', 'setter', 'both']).nullable().optional();

/** Partial patch schema for PATCH /api/users/[id]. All fields optional. */
export const patchUserSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  repType: repTypeEnum,
  // Only rep↔sub-dealer flips go through this field. Admin/PM roles can't
  // be set or unset via PATCH — those are separate workflows.
  role: z.enum(['rep', 'sub-dealer']).optional(),
  active: z.boolean().optional(),
  canRequestBlitz: z.boolean().optional(),
  canCreateBlitz: z.boolean().optional(),
  canExport: z.boolean().optional(),
  canCreateDeals: z.boolean().optional(),
  canAccessBlitz: z.boolean().optional(),
  // Vendor-PM scope. Non-null cuid = scope this PM to that installer
  // (vendor PM). Null = full internal PM access. Empty string = same as
  // null (easier for the form to zero out).
  scopedInstallerId: z.union([z.string().cuid(), z.literal(''), z.null()]).optional(),
}).strict();
export type PatchUserInput = z.infer<typeof patchUserSchema>;
