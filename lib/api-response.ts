/**
 * api-response.ts — discriminated-union helpers for /api route handlers.
 *
 * The pre-existing pattern across the 51 mutating routes was inconsistent:
 *
 *   NextResponse.json(entity)                     — bare entity (success)
 *   NextResponse.json({ error: '…' }, { status }) — error envelope (failure)
 *   NextResponse.json({ success: true })          — generic success
 *   NextResponse.json({ ok: true })               — alternative success
 *   NextResponse.json({ id: x, idempotent: true })— success with metadata
 *
 * Different routes returned different shapes. Callers had to special-case
 * each endpoint. This file is the single response shape going forward:
 *
 *   { ok: true, data: T }            — every success
 *   { ok: false, reason: string,     — every failure
 *     code?: string }                  optional machine-readable code
 *
 * Mirrors the lib/validation.ts ValidationResult shape so the same
 * discriminated-union pattern applies on both sides of the wire.
 *
 * **Adoption strategy:** purely additive. Existing routes keep their
 * current shape until touched for another reason. New routes use these
 * helpers. Eventually a CI gate will flag bare NextResponse.json in
 * favor of apiOk/apiError, but not yet — the migration would touch
 * every client-side fetch and we don't have the budget for that this
 * cycle. See scripts/audit-coverage.allowlist.json for the equivalent
 * "ratchet, don't rewrite" pattern.
 */

import { NextResponse } from 'next/server';

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; reason: string; code?: string };
export type ApiResponse<T> = ApiOk<T> | ApiErr;

/** Wrap a successful payload. Defaults to 200 OK; pass 201 for create. */
export function apiOk<T>(data: T, status: number = 200): NextResponse<ApiOk<T>> {
  return NextResponse.json({ ok: true, data }, { status });
}

/**
 * Wrap a failure. `reason` is admin-friendly copy that's safe to show
 * in a toast. `code` is an optional machine-readable string (e.g.
 * 'retroactive_effective_date', 'tier_loss_making') for client-side
 * branching — the existing /api/products POST already uses this
 * pattern with the bare-error shape; this just standardizes it.
 */
export function apiError(
  reason: string,
  status: number = 400,
  code?: string,
): NextResponse<ApiErr> {
  return NextResponse.json(
    code ? { ok: false, reason, code } : { ok: false, reason },
    { status },
  );
}

/** Convert a ValidationResult-style failure into an HTTP response. */
export function apiErrorFromValidation(
  result: { ok: false; reason: string },
  status: number = 400,
): NextResponse<ApiErr> {
  return apiError(result.reason, status);
}
