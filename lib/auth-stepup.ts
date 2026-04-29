/**
 * auth-stepup.ts — step-up authentication for sensitive admin operations.
 *
 * For ops where session-cookie theft would have outsized blast radius
 * (bulk pricing changes, retroactive versions, hard delete of pricing
 * data), we require the admin's Clerk session to be "fresh" — meaning
 * they authenticated within the last `maxAge` seconds.
 *
 * If the session is too old, the request is rejected with 401 +
 * { error: 'step_up_required', maxAge } so the client can prompt for
 * re-authentication and retry.
 *
 * NOT used for everyday operations (single-tier edits, single-product
 * creation) — that would be friction without proportional security benefit.
 *
 * Threat model: a stolen session cookie + access to admin's machine =
 * admin-equivalent compromise. Step-up doesn't fully prevent this, but
 * it shrinks the window: an attacker with a stolen cookie has to
 * complete fresh auth (potentially MFA, captcha) before any sensitive
 * baseline op succeeds. Sustained access becomes harder without also
 * compromising the auth factor.
 */

import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { requireAdmin } from './api-auth';

export interface FreshAdminResult {
  user: Awaited<ReturnType<typeof requireAdmin>>;
  authTimeUnix: number;
  ageSeconds: number;
}

/**
 * Verify the requester is an admin AND their Clerk session is fresh
 * (auth_time within `maxAgeSeconds`).
 *
 * Throws a NextResponse on failure (401 unauthorized, 403 forbidden, or
 * 401 step_up_required with details). Returns the user + freshness
 * metadata on success.
 *
 * Default 600s (10 min) — enough that a focused admin doing a normal
 * editing session won't be re-prompted; short enough that a stale tab
 * left open overnight forces re-auth before any destructive op.
 */
export async function requireFreshAdmin(maxAgeSeconds: number = 600): Promise<FreshAdminResult> {
  // First check the basic admin gate — if this throws, propagate.
  const user = await requireAdmin();

  // Pull session info to verify auth_time freshness.
  const session = await auth();
  const clerkUser = await currentUser();

  // sessionClaims is the JWT payload — auth_time is the unix timestamp
  // of when the user actually authenticated (not when the session was
  // last validated, which would defeat the whole point).
  const claims = (session?.sessionClaims ?? {}) as Record<string, unknown>;
  const authTime = typeof claims.auth_time === 'number' ? claims.auth_time : null;

  if (authTime == null) {
    // No auth_time claim — defensive. This shouldn't happen with Clerk
    // but if the JWT shape changes we want to fail closed, not silent.
    throw NextResponse.json(
      {
        error: 'step_up_required',
        reason: 'auth_time_missing',
        maxAgeSeconds,
        message: 'Session metadata missing — please re-authenticate.',
      },
      { status: 401 },
    );
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  const ageSeconds = nowUnix - authTime;

  if (ageSeconds > maxAgeSeconds) {
    throw NextResponse.json(
      {
        error: 'step_up_required',
        reason: 'session_too_old',
        ageSeconds,
        maxAgeSeconds,
        message: `Session is ${ageSeconds}s old; sensitive operations require re-authentication within the last ${maxAgeSeconds}s.`,
      },
      { status: 401 },
    );
  }

  // Defensive: also confirm clerkUser still resolves. If the user was
  // deleted between requireAdmin's lookup and now, fail.
  if (!clerkUser) {
    throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return { user, authTimeUnix: authTime, ageSeconds };
}
