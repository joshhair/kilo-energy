/**
 * Feedback API request schema. Used by POST /api/feedback.
 *
 * Length caps prevent oversized payloads from landing in DB / email.
 * The `url` and `userAgent` are optional debug context — if the client
 * doesn't send them, the row still persists with the message intact.
 */

import { z } from 'zod';

export const createFeedbackSchema = z.object({
  /** User-typed feedback text. 1-2000 chars after trim. */
  message: z.string().trim().min(1, 'Message is required').max(2000, 'Message is too long'),
  /** Page path the user was on when they clicked the widget. */
  url: z.string().max(500).optional(),
  /** Browser/OS string. The route can also pull from req headers as a fallback. */
  userAgent: z.string().max(500).optional(),
}).strict();

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
