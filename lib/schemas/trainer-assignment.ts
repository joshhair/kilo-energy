import { z } from 'zod';
import { idSchema, pricePerWatt } from '../api-validation';

// Maximum allowed trainer override rate. $0.50/W is 5x the typical setter
// premium of $0.10/W. Anything above this risks eating into closer pay
// at low soldPPW and is almost certainly a data-entry mistake.
export const MAX_TRAINER_RATE_PER_W = 0.5;

const tierSchema = z.object({
  upToDeal: z.number().int().positive().nullable(),
  ratePerW: pricePerWatt.max(MAX_TRAINER_RATE_PER_W, `ratePerW exceeds cap of $${MAX_TRAINER_RATE_PER_W}/W — likely a data-entry error`),
});

/** Superrefine: catch-all tier (upToDeal=null) must be last, and explicit tiers must be ascending. */
function validateTierOrder(tiers: z.infer<typeof tierSchema>[], ctx: z.RefinementCtx) {
  for (let i = 1; i < tiers.length; i++) {
    const prev = tiers[i - 1].upToDeal;
    const cur = tiers[i].upToDeal;
    if (prev === null && cur !== null) {
      ctx.addIssue({ code: 'custom', path: [i, 'upToDeal'], message: 'null (catch-all) tier must be last' });
      return;
    }
    if (prev !== null && cur !== null && cur <= prev) {
      ctx.addIssue({ code: 'custom', path: [i, 'upToDeal'], message: 'tiers must be in ascending upToDeal order' });
      return;
    }
  }
}

export const createTrainerAssignmentSchema = z.object({
  trainerId: idSchema,
  traineeId: idSchema,
  tiers: z.array(tierSchema).max(20).default([]).superRefine(validateTierOrder),
}).refine((d) => d.trainerId !== d.traineeId, {
  message: 'trainer and trainee must be different users',
  path: ['traineeId'],
});
export type CreateTrainerAssignmentInput = z.infer<typeof createTrainerAssignmentSchema>;

export const patchTrainerAssignmentSchema = z.object({
  id: idSchema,
  tiers: z.array(tierSchema).max(20).default([]).superRefine(validateTierOrder),
});
export type PatchTrainerAssignmentInput = z.infer<typeof patchTrainerAssignmentSchema>;

export const deleteTrainerAssignmentSchema = z.object({
  id: idSchema,
});
