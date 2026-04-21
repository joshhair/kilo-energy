import { z } from 'zod';
import { idSchema, optionalId, moneyAmount, optionalString } from '../api-validation';

// ─── Blitz ──────────────────────────────────────────────────────────────────

export const createBlitzSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
  location: optionalString.default(''),
  housing: optionalString.default(''),
  startDate: z.string().min(1, 'startDate is required'),
  endDate: z.string().min(1, 'endDate is required'),
  notes: optionalString.default(''),
  status: z.enum(['upcoming', 'active', 'completed', 'cancelled']).optional().default('upcoming'),
  ownerId: optionalId,          // admin-only override; non-admins are forced
});
export type CreateBlitzInput = z.infer<typeof createBlitzSchema>;

export const patchBlitzSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  location: z.string().max(500).optional(),
  housing: z.string().max(500).optional(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  notes: z.string().max(5000).optional(),
  status: z.enum(['upcoming', 'active', 'completed', 'cancelled']).optional(),
  ownerId: idSchema.optional(),  // only honored when caller is admin
}).strict();
export type PatchBlitzInput = z.infer<typeof patchBlitzSchema>;

// ─── Blitz costs ────────────────────────────────────────────────────────────

export const createBlitzCostSchema = z.object({
  category: z.string().trim().min(1, 'category is required').max(100),
  amount: moneyAmount.max(1_000_000, 'amount exceeds sanity cap'),
  description: optionalString.default(''),
  date: z.string().min(1, 'date is required'),
});
export type CreateBlitzCostInput = z.infer<typeof createBlitzCostSchema>;

// ─── Blitz participants ─────────────────────────────────────────────────────

const joinStatusEnum = z.enum(['pending', 'approved', 'declined']);
const attendanceStatusEnum = z.enum(['attended', 'no-show', 'partial']);

export const createBlitzParticipantSchema = z.object({
  userId: idSchema,
  joinStatus: joinStatusEnum.optional(),
});
export type CreateBlitzParticipantInput = z.infer<typeof createBlitzParticipantSchema>;

export const patchBlitzParticipantSchema = z.object({
  userId: idSchema,
  joinStatus: joinStatusEnum.optional(),
  attendanceStatus: attendanceStatusEnum.nullable().optional(),
}).refine(
  (d) => d.joinStatus !== undefined || d.attendanceStatus !== undefined,
  { message: 'joinStatus or attendanceStatus required' },
);
export type PatchBlitzParticipantInput = z.infer<typeof patchBlitzParticipantSchema>;

// ─── Blitz requests ─────────────────────────────────────────────────────────

const blitzRequestBase = z.object({
  location: optionalString.default(''),
  housing: optionalString.default(''),
  notes: optionalString.default(''),
  expectedHeadcount: z.number().int().nonnegative().optional().default(0),
});

export const createBlitzRequestSchema = z.discriminatedUnion('type', [
  blitzRequestBase.extend({
    type: z.literal('create'),
    name: z.string().trim().min(1),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    blitzId: optionalId,
  }),
  blitzRequestBase.extend({
    type: z.literal('cancel'),
    blitzId: idSchema,
    name: optionalString,
    startDate: optionalString,
    endDate: optionalString,
  }),
]);
export type CreateBlitzRequestInput = z.infer<typeof createBlitzRequestSchema>;

export const patchBlitzRequestSchema = z.object({
  status: z.enum(['pending', 'approved', 'denied']).optional(),
  adminNotes: z.string().max(2000).optional(),
}).strict().refine((d) => d.status !== undefined || d.adminNotes !== undefined, {
  message: 'status or adminNotes required',
});
export type PatchBlitzRequestInput = z.infer<typeof patchBlitzRequestSchema>;

// ─── Incentives patch ───────────────────────────────────────────────────────

const milestonePatchSchema = z.object({
  id: idSchema.optional(),
  threshold: z.number().positive(),
  reward: z.string().min(1).max(500),
  achieved: z.boolean().optional(),
});

export const patchIncentiveSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  active: z.boolean().optional(),
  endDate: z.string().nullable().optional(),
  startDate: z.string().optional(),
  metric: z.enum(['deals', 'kw', 'commission', 'revenue']).optional(),
  period: z.enum(['month', 'quarter', 'year', 'alltime']).optional(),
  type: z.enum(['company', 'personal']).optional(),
  targetRepId: optionalId,
  milestones: z.array(milestonePatchSchema).max(20).optional(),
}).strict();
export type PatchIncentiveInput = z.infer<typeof patchIncentiveSchema>;

// ─── Financers ──────────────────────────────────────────────────────────────

export const createFinancerSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateFinancerInput = z.infer<typeof createFinancerSchema>;

export const patchFinancerSchema = z.object({
  active: z.boolean(),
}).strict();
export type PatchFinancerInput = z.infer<typeof patchFinancerSchema>;

// ─── Reps / Users ───────────────────────────────────────────────────────────

export const createRepSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(50).optional().default(''),
  role: z.enum(['rep', 'admin', 'sub-dealer', 'project_manager']).optional().default('rep'),
  repType: z.enum(['closer', 'setter', 'both']).optional().default('both'),
});
export type CreateRepInput = z.infer<typeof createRepSchema>;

export const patchRepSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  repType: z.enum(['closer', 'setter', 'both']).optional(),
  active: z.boolean().optional(),
}).strict();
export type PatchRepInput = z.infer<typeof patchRepSchema>;

// ─── Prepaid options ────────────────────────────────────────────────────────

export const createPrepaidOptionSchema = z.object({
  installerId: idSchema,
  name: z.string().trim().min(1).max(200),
});
export type CreatePrepaidOptionInput = z.infer<typeof createPrepaidOptionSchema>;

export const renamePrepaidOptionSchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type RenamePrepaidOptionInput = z.infer<typeof renamePrepaidOptionSchema>;

// ─── Project messages (chatter) ─────────────────────────────────────────────

const checkItemInputSchema = z.union([
  z.string().min(1).max(500),
  z.object({
    text: z.string().min(1).max(500),
    dueDate: z.string().nullable().optional(),
  }),
]);

export const createProjectMessageSchema = z.object({
  text: z.string().min(1, 'message text is required').max(10_000),
  checkItems: z.array(checkItemInputSchema).max(50).optional(),
  mentionUserIds: z.array(idSchema).max(50).optional(),
});
export type CreateProjectMessageInput = z.infer<typeof createProjectMessageSchema>;

/** PATCH /api/projects/[id]/messages/[messageId] — polymorphic.
 *  Either toggles a check item OR marks mentions read. Exactly one branch. */
export const patchProjectMessageSchema = z.union([
  z.object({
    checkItemId: idSchema,
    completed: z.boolean().optional(),
    dueDate: z.string().nullable().optional(),
  }).refine((d) => d.completed !== undefined || d.dueDate !== undefined, {
    message: 'completed or dueDate required',
  }),
  z.object({
    markMentionRead: z.literal(true),
  }),
]);
export type PatchProjectMessageInput = z.infer<typeof patchProjectMessageSchema>;

// ─── Project activity ──────────────────────────────────────────────────────

export const createProjectActivitySchema = z.object({
  type: z.string().trim().min(1).max(50),
  detail: z.string().trim().min(1).max(2000),
  meta: z.string().max(5000).nullable().optional(),  // JSON-encoded on the client
});
export type CreateProjectActivityInput = z.infer<typeof createProjectActivitySchema>;

// ─── User invite ────────────────────────────────────────────────────────────

export const createUserInviteSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(50).optional().default(''),
  role: z.enum(['rep', 'sub-dealer', 'admin', 'project_manager']).optional().default('rep'),
  repType: z.enum(['closer', 'setter', 'both']).optional(),
});
export type CreateUserInviteInput = z.infer<typeof createUserInviteSchema>;
