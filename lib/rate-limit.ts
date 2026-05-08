/**
 * rate-limit.ts — distributed rate limiting with an in-memory fallback.
 *
 * Primary: Upstash Redis via `@upstash/ratelimit` sliding window. Shared
 * across all Vercel Function instances, survives cold starts. This is the
 * correct rate limiter for a multi-region serverless deploy — the prior
 * in-memory Map was ceremonial at best (each cold lambda had its own
 * counter, so attackers rotated instances around it).
 *
 * Fallback: the old in-memory Map, used only when Upstash env vars are
 * absent (local dev without an Upstash project, or a misconfigured env).
 * Fallback mode logs a warning on every cold start so it never silently
 * becomes the prod path.
 *
 * Env:
 *   UPSTASH_REDIS_REST_URL   — set by Vercel Marketplace Upstash integration
 *   UPSTASH_REDIS_REST_TOKEN — same
 *
 * Public API is the same as before except that `checkRateLimit` and
 * `enforceRateLimit` are now async (callers must `await`).
 *
 * Usage:
 *   const limited = await enforceRateLimit(`POST /api/payroll:${user.id}`, 60, 60_000);
 *   if (limited) return limited;
 */

import { NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ─── Upstash path ──────────────────────────────────────────────────────

let redisSingleton: Redis | null = null;
let warnedAboutFallback = false;

function getRedis(): Redis | null {
  if (redisSingleton) return redisSingleton;
  // Vercel Marketplace Upstash emits env vars as `{PREFIX}_KV_REST_API_URL`
  // / `{PREFIX}_KV_REST_API_TOKEN` — the prefix is whatever the operator
  // configured at link time (we chose `UPSTASH_REDIS_REST`). The Upstash SDK
  // itself documents the shorter `UPSTASH_REDIS_REST_URL` pair, so we accept
  // either convention. Prefer the KV-style names (what Vercel actually sets)
  // and fall back to the SDK-canonical pair for hand-rolled setups.
  const url =
    process.env.UPSTASH_REDIS_REST_KV_REST_API_URL ??
    process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN ??
    process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!warnedAboutFallback) {
      console.warn(
        '[rate-limit] UPSTASH_REDIS_REST_URL / _TOKEN not set — falling back to in-memory (NOT distributed). ' +
        'Set the env vars in Vercel → Integrations → Upstash before production traffic.',
      );
      warnedAboutFallback = true;
    }
    return null;
  }
  redisSingleton = new Redis({ url, token });
  return redisSingleton;
}

// Ratelimit instances are configured per (limit, windowMs) combo, so we
// memoize to avoid re-constructing on every call.
const ratelimiters = new Map<string, Ratelimit>();

function getRatelimiter(limit: number, windowMs: number): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  const cacheKey = `${limit}:${windowMs}`;
  let rl = ratelimiters.get(cacheKey);
  if (!rl) {
    rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
      prefix: 'kilo-rl',
      analytics: false,
    });
    ratelimiters.set(cacheKey, rl);
  }
  return rl;
}

// ─── In-memory fallback (unchanged from the pre-Upstash implementation) ─

type Bucket = { count: number; windowStart: number };
const MAX_BUCKETS = 10_000;
const buckets = new Map<string, Bucket>();

function evictIfFull() {
  if (buckets.size <= MAX_BUCKETS) return;
  const toEvict = Math.ceil(MAX_BUCKETS * 0.1);
  let i = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    if (++i >= toEvict) break;
  }
}

function checkInMemory(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
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

// ─── Public API ────────────────────────────────────────────────────────

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;       // epoch ms
  retryAfterMs: number;  // 0 if ok
}

/** Check and increment the counter for `key`. Uses Upstash if configured,
 *  in-memory otherwise. The `now` override only affects the in-memory path
 *  (used by unit tests to fake clock progression). */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const rl = getRatelimiter(limit, windowMs);
  if (rl) {
    const r = await rl.limit(key);
    const retryAfterMs = r.success ? 0 : Math.max(0, r.reset - Date.now());
    return { ok: r.success, remaining: r.remaining, resetAt: r.reset, retryAfterMs };
  }
  return checkInMemory(key, limit, windowMs, now);
}

/** Build a 429 response from a failed check. */
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

/** Convenience: run a limit check and return the 429 if exceeded, or null
 *  if the call is allowed. Use as:
 *    const limited = await enforceRateLimit(`POST /x:${userId}`, 60, 60_000);
 *    if (limited) return limited;
 */
export async function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<NextResponse | null> {
  const r = await checkRateLimit(key, limit, windowMs);
  return r.ok ? null : rateLimitResponse(r);
}

/** Admin mutation rate-limit preset.
 *
 *  Catches runaway scripts and bounds the blast radius of a compromised
 *  admin token. 30 ops/min is well above any sane manual workflow (a
 *  human clicking through the admin UI tops out around 5/min, and the
 *  bulk apply endpoints already use tighter dedicated limits at 10/min).
 *
 *  Use as:
 *    const limited = await enforceAdminMutationLimit(actor.id, 'POST /api/financers');
 *    if (limited) return limited;
 */
export async function enforceAdminMutationLimit(
  actorId: string,
  routeKey: string,
): Promise<NextResponse | null> {
  return enforceRateLimit(`admin-mutation:${routeKey}:${actorId}`, 30, 60_000);
}

// Internal test hook — resets both in-memory state and the Ratelimit
// memoization cache so suites can run independently.
export function _resetForTests() {
  buckets.clear();
  ratelimiters.clear();
  redisSingleton = null;
  warnedAboutFallback = false;
}
