import { z } from 'zod';

const repTypeEnum = z.enum(['solo', 'self-gen', 'trainee', 'sub-dealer']).optional();

/** Partial patch schema for PATCH /api/users/[id]. All fields optional. */
export const patchUserSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  repType: repTypeEnum,
  active: z.boolean().optional(),
  canRequestBlitz: z.boolean().optional(),
  canCreateBlitz: z.boolean().optional(),
  canExport: z.boolean().optional(),
  canCreateDeals: z.boolean().optional(),
  canAccessBlitz: z.boolean().optional(),
}).strict();
export type PatchUserInput = z.infer<typeof patchUserSchema>;
