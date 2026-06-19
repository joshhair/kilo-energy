import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import { enforceRateLimit } from './lib/rate-limit';
import { assertSameOrigin, MUTATION_METHODS } from './lib/csrf';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  // Legal pages must be readable without auth — linked from the sign-in
  // footer; people need to read privacy/terms before creating an account.
  '/legal/(.*)',
  // PWA install assets must be fetchable before the user authenticates —
  // the browser requests the manifest while still on the sign-in page.
  // `/manifest.json` is NOT covered by the static-asset matcher bypass
  // below because `.json` is deliberately excluded there (API routes
  // return JSON), so it reaches middleware and must be allowlisted here.
  // The icons (`.png`/`.svg`) ARE already bypassed by the matcher; listing
  // `/icons(.*)` documents the intent and covers any extensionless probe.
  '/manifest.json',
  '/icons(.*)',
]);

const isApiRoute = createRouteMatcher(['/api/:path*']);

// Routes that should bypass the global rate limit even though they're
// API paths. Clerk webhooks have their own rate controls upstream;
// health / auth-status endpoints must stay responsive.
const bypassGlobalRateLimit = createRouteMatcher([
  '/api/webhooks(.*)',
  '/api/auth/me',
]);

// Default global rate limits. Per-route handlers can still enforce
// tighter caps for hot endpoints (e.g. /api/payroll POST at 60/min/
// user — that's on top of these).
//
// The GET limit is generous (low abuse risk + UI hydration uses
// /api/data which can fire multiple times on a fresh session). The
// mutation limit is tighter (anyone hitting 120 writes/minute from
// a single IP is abuse — legitimate admin work is tens/minute
// peak).
const GLOBAL_READ_LIMIT = 600;
const GLOBAL_MUTATION_LIMIT = 120;
const GLOBAL_WINDOW_MS = 60_000;

/**
 * Global API rate limit, keyed by client IP.
 *
 * Runs ONLY on /api routes (pages have their own caching / generally
 * aren't DoS vectors). Separates read from mutation limits. Bypass
 * list covers routes whose availability is more important than
 * rate-limit protection (auth-status, Clerk webhooks).
 *
 * Per-route handlers can still enforce tighter limits keyed by user
 * ID — e.g. POST /api/payroll has `enforceRateLimit('POST /api/
 * payroll:${actor.id}', 60, 60_000)`. That's additive; the global
 * IP limit is the floor, the per-route user limit is the ceiling.
 *
 * IP discovery: Vercel sets `x-forwarded-for` on every request with
 * the client's real IP as the first CSV entry. In dev, fall back to
 * a constant so local testing isn't rate-limited out of existence.
 */
async function enforceGlobalApiRateLimit(request: NextRequest): Promise<NextResponse | null> {
  if (!isApiRoute(request)) return null;
  if (bypassGlobalRateLimit(request)) return null;

  const fwd = request.headers.get('x-forwarded-for') ?? '';
  const ip = fwd.split(',')[0]?.trim() || '127.0.0.1-dev';
  const isMutation = MUTATION_METHODS.has(request.method);
  const limit = isMutation ? GLOBAL_MUTATION_LIMIT : GLOBAL_READ_LIMIT;
  const key = `global:${isMutation ? 'mut' : 'read'}:${ip}`;

  return enforceRateLimit(key, limit, GLOBAL_WINDOW_MS);
}

export default clerkMiddleware(async (auth, request) => {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const rateLimited = await enforceGlobalApiRateLimit(request);
  if (rateLimited) return rateLimited;

  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
