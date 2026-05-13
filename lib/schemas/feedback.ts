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
  /**
   * Optional viewport screenshot, base64-encoded JPEG (no data: prefix).
   * Cap at 4MB of base64 (~3MB binary) to stay safely under Vercel's
   * 4.5MB function payload limit. The client is opt-in via a checkbox.
   */
  screenshotBase64: z
    .string()
    .max(4_000_000, 'Screenshot too large')
    .regex(/^[A-Za-z0-9+/=]+$/, 'Screenshot must be base64-encoded')
    .optional(),
}).strict();

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
