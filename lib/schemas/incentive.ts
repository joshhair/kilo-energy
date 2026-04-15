import { z } from 'zod';
import { idSchema, optionalId, optionalString } from '../api-validation';

const metricEnum = z.enum(['deals', 'kw', 'commission', 'revenue']);
const periodEnum = z.enum(['month', 'quarter', 'year', 'alltime']);
const typeEnum = z.enum(['company', 'personal']);

const milestoneSchema = z.object({
  threshold: z.number().positive('threshold must be > 0'),
  reward: z.string().min(1, 'reward is required').max(500),
});

/** Request body for POST /api/incentives — admin-only create flow. */
export const createIncentiveSchema = z.object({
  title: z.string().min(1, 'title is required').max(200),
  description: optionalString.default(''),
  type: typeEnum,
  metric: metricEnum,
  period: periodEnum,
  startDate: z.string().min(1, 'startDate is required'),  // ISO YYYY-MM-DD
  endDate: optionalString,                                // null/empty allowed
  targetRepId: optionalId,                                // required only when type=personal
  active: z.boolean().optional().default(true),
  blitzId: optionalId,
  milestones: z.array(milestoneSchema).min(1, 'at least one milestone is required').max(20),
}).refine(
  (d) => d.type !== 'personal' || !!d.targetRepId,
  { message: 'targetRepId is required for personal incentives', path: ['targetRepId'] },
);
export type CreateIncentiveInput = z.infer<typeof createIncentiveSchema>;
