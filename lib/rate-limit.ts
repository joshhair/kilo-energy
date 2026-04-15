/**
 * rate-limit.ts — simple in-memory per-key rate limiter.
 *
 * For a pre-launch internal app this is enough. It prevents a malicious
 * or buggy authenticated client from flooding a mutation endpoint (e.g.
 * re-submitting a deal form in a loop, or an admin script gone rogue).
 *
 * Limitations (accepted pre-launch):
 * - Per-instance, not distributed. If Vercel scales to N lambdas each has
 *   its own counter → effective limit is N × limit. For our scale and the
 *   threat we're modelling (human-speed abuse, runaway client), this is
 *   still a useful ceiling.
 * - Resets on cold start. Fine — cold starts happen between humans.
 *
 * When to upgrade to Vercel KV / Upstash:
 * - When we start seeing 429s from legitimate users due to lambda fan-out,
 *   OR when we need to defend against a coordinated attack (distributed
 *   counter + IP + user-agent heuristics + GeoIP).
 *
 * Usage:
 *   const rl = checkRateLimit(`POST /api/payroll:${user.id}`, 60, 60_000);
 *   if (!rl.ok) return rateLimitResponse(rl);
 */

import { NextResponse } from 'next/server';

type Bucket = {
  count: number;
  windowStart: number;   // epoch ms
};

// Max distinct keys we'll track before evicting the oldest. Pre-launch
// we have O(hundreds of users × routes) so a few thousand buckets is
// plenty. Any higher = we're under attack and need to upgrade anyway.
const MAX_BUCKETS = 10_000;

const buckets = new Map<string, Bucket>();

function evictIfFull() {
  if (buckets.size <= MAX_BUCKETS) return;
  // Drop the oldest 10% in one pass. Map iteration order is insertion
  // order, so the oldest are at the front.
  const toEvict = Math.ceil(MAX_BUCKETS * 0.1);
  let i = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    if (++i >= toEvict) break;
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;     // requests left in the current window
  resetAt: number;       // epoch ms when the window rolls over
  retryAfterMs: number;  // ms to wait before trying again (0 if ok)
}

/** Check and increment the counter for `key`. Fixed-window algorithm. */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    // New bucket or window has rolled — reset.
    buckets.set(key, { count: 1, windowStart: now });
    evictIfFull();
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs, retryAfterMs: 0 };
  }

  bucket.count += 1;
  const resetAt = bucket.windowStart + windowMs;
  if (bucket.count > limit) {
    return { ok: false, remaining: 0, resetAt, retryAfterMs: resetAt - now };
  }
  return { ok: true, remaining: limit - bucket.count, resetAt, retryAfterMs: 0 };
}

/** Build a 429 Response from a failed check. Sets Retry-After + standard
 *  X-RateLimit headers so clients can back off cleanly. */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfterSec = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  return NextResponse.json(
    { error: 'Too many requests', retryAfterSec },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
      },
    },
  );
}

/** Convenience: run a limit check and return the 429 response if exceeded,
 *  or null if the call is allowed. Use as:
 *    const limited = enforceRateLimit(`POST /x:${userId}`, 60, 60_000);
 *    if (limited) return limited;
 */
export function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const r = checkRateLimit(key, limit, windowMs);
  return r.ok ? null : rateLimitResponse(r);
}

// Internal test hook — lets unit tests reset global state without
// exporting the Map directly.
export function _resetForTests() {
  buckets.clear();
}
