/**
 * Zod schemas for the notification preferences API.
 *
 * GET /api/notifications/preferences
 *   - Returns the catalog of events visible to the user's role + their
 *     current preference for each (with default fallback).
 *
 * PATCH /api/notifications/preferences
 *   - Updates a single (eventType, channel-toggle | digestMode) entry.
 *   - Validation: eventType must exist in NOTIFICATION_EVENTS (event-type
 *     existence is enforced at runtime in the route handler since the
 *     registry is dynamic).
 */

import { z } from 'zod';

export const digestModeSchema = z.enum(['instant', 'daily_digest', 'weekly_digest', 'off']);

export const patchNotificationPreferenceSchema = z.object({
  eventType: z.string().min(1).max(100),
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  digestMode: digestModeSchema.optional(),
});

export type PatchNotificationPreferenceInput = z.infer<typeof patchNotificationPreferenceSchema>;

/**
 * Phone verification flow — one-time-code validation.
 * Used by /api/notifications/verify-phone (lands in Phase 4 with Twilio).
 * Schema lives here so the UI can import it for client-side validation.
 */
export const requestPhoneCodeSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{1,14}$/, 'phone must be E.164 (e.g. +14155551234)'),
});

export const confirmPhoneCodeSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{1,14}$/),
  code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
});

/**
 * Quiet hours — 0–23 UTC hours, both null (or both equal) disables.
 * The server treats 8 → 22 as "no SMS/push between 08:00 and 22:00 UTC".
 */
export const patchQuietHoursSchema = z.object({
  startUtc: z.number().int().min(0).max(23).nullable(),
  endUtc: z.number().int().min(0).max(23).nullable(),
});
