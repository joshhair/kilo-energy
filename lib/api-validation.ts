/**
 * api-validation.ts — Zod-based request validation for /api route handlers.
 *
 * Usage:
 *   const parsed = await parseJsonBody(req, MyRequestSchema);
 *   if (!parsed.ok) return parsed.response;
 *   // parsed.data is now typed + validated
 *
 * Why: every API handler was trusting body.foo to have the right shape,
 * type, and bounds. One bad client request (or a malicious auth'd user)
 * could crash a handler or write garbage to the DB. Zod puts a hard
 * validation gate at the boundary and gives us typed data inside.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError, ZodSchema } from 'zod';

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

/** Parse + validate a JSON body against a Zod schema. Returns a typed result or a 400 response. */
export async function parseJsonBody<T>(
  req: NextRequest,
  schema: ZodSchema<T>,
): Promise<ParseResult<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Validation failed', issues: formatIssues(result.error) }, { status: 400 }),
    };
  }
  return { ok: true, data: result.data };
}

/** Parse + validate URL search params against a Zod schema. */
export function parseSearchParams<T>(
  url: URL,
  schema: ZodSchema<T>,
): ParseResult<T> {
  const obj: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) obj[k] = v;
  const result = schema.safeParse(obj);
  if (!result.success) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Validation failed', issues: formatIssues(result.error) }, { status: 400 }),
    };
  }
  return { ok: true, data: result.data };
}

function formatIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }));
}

/**
 * Parse + validate a JSON string against a Zod schema. Returns the typed
 * value on success, or `null` on parse OR validation failure.
 *
 * Use for non-request JSON: stringified DB columns (e.g. installer.ccEmails,
 * StalledAlertConfig.phaseThresholds), webhook payloads where we own the
 * fallback path. Replaces the `JSON.parse(json) as unknown` + hand-rolled
 * narrowing pattern that scattered across cron + admin + handoff routes.
 *
 * Why no thrown errors: callers all want a graceful fallback (empty list,
 * default object) when stored JSON is malformed. Returning null lets the
 * caller use `parseJsonSafe(...) ?? defaultValue`.
 *
 *   const recipients = parseJsonSafe(row.digestRecipients, z.array(z.string())) ?? [];
 */
export function parseJsonSafe<T>(input: string | null | undefined, schema: ZodSchema<T>): T | null {
  if (input == null || input === '') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    return null;
  }
  const result = schema.safeParse(raw);
  return result.success ? result.data : null;
}

// ─── Shared atoms used across domain schemas ────────────────────────────────

export const idSchema = z.string().min(1, 'id required').max(100);

/** Optional ID that accepts "", null, or undefined (all normalized to undefined).
 *  Use for fields where the client may send an empty-string placeholder
 *  (e.g. financerId="" on Cash deals). */
export const optionalId = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.string().min(1).max(100).optional(),
);
/** Nullable ID for PATCH fields that support explicit clearing.
 *  "" → null, null → null, undefined → undefined, string → string.
 *  Use for closerId/setterId on project patches where the client
 *  sends "" or null to unlink the rep. */
export const nullableId = z.preprocess(
  (v) => (v === '' ? null : v),
  z.string().min(1).max(100).nullable().optional(),
);
export const nonEmptyString = z.string().min(1);
export const optionalString = z.string().optional().nullable();
/** Finite, non-NaN number. */
export const finiteNumber = z.number().refine(Number.isFinite, 'must be a finite number');
/** Non-negative money amount (dollars). Rounded to cents downstream. */
export const moneyAmount = finiteNumber.nonnegative('amount must be ≥ 0');
/** Integer ≥ 0. */
export const nonNegInt = z.number().int().nonnegative();
/** Price per watt (USD). Caps at $10/W as a sanity bound. */
export const pricePerWatt = finiteNumber.min(0).max(10, 'price/W exceeds sanity cap');
