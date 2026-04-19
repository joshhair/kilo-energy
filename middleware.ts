import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import { enforceRateLimit } from './lib/rate-limit';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  // Legal pages must be readable without auth — linked from the sign-in
  // footer; people need to read privacy/terms before creating an account.
  '/legal/(.*)',
]);

const isApiRoute = createRouteMatcher(['/api/:path*']);

// Routes that should bypass the global rate limit even though they're
// API paths. Clerk webhooks have their own rate controls upstream;
// health / auth-status endpoints must stay responsive.
const bypassGlobalRateLimit = createRouteMatcher([
  '/api/webhooks(.*)',
  '/api/auth/me',
]);

// State-changing HTTP methods. GET/HEAD/OPTIONS can't mutate, so they
// don't need the Origin/Referer CSRF check.
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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
 * Belt-and-suspenders CSRF defense. Clerk's session cookie already has
 * SameSite=Lax which blocks cross-origin POSTs in all modern browsers,
 * but we add an explicit Origin/Referer same-origin check on every
 * mutation to close the narrow window of browsers that get it wrong
 * (older Safari quirks, some WebView embeds). Webhook routes are exempt
 * because they're signed payloads from Clerk/Vercel with no session.
 */
function assertSameOrigin(request: Request): NextResponse | null {
  if (!MUTATION_METHODS.has(request.method)) return null;

  const url = new URL(request.url);
  // Skip webhooks — they're unsigned to us but verified by the webhook's
  // own signature header (Clerk HMAC, etc.).
  if (url.pathname.startsWith('/api/webhooks')) return null;

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const expected = url.origin;

  // If we have an Origin header, it must match. Browsers send Origin on
  // every POST/PUT/PATCH/DELETE in modern engines.
  if (origin) {
    if (origin === expected) return null;
    return NextResponse.json({ error: 'CSRF: origin mismatch' }, { status: 403 });
  }

  // Fallback to Referer when Origin is absent (older clients / some apps).
  if (referer) {
    try {
      if (new URL(referer).origin === expected) return null;
    } catch { /* fall through to reject */ }
    return NextResponse.json({ error: 'CSRF: referer mismatch' }, { status: 403 });
  }

  // Neither header present — reject to be safe. Same-origin browser
  // fetches always send Origin; lack of both is either a malformed
  // request or a server-side call (which wouldn't hit middleware anyway).
  return NextResponse.json({ error: 'CSRF: no origin' }, { status: 403 });
}

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
