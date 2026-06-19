import { NextResponse } from 'next/server';

// State-changing HTTP methods. GET/HEAD/OPTIONS can't mutate, so they don't
// need the Origin/Referer CSRF check.
export const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * True when the request authenticates with an `Authorization: Bearer <token>`
 * header instead of the browser session cookie. The native iOS app and
 * server-to-server callers (cron / admin jobs) use this path.
 */
export function hasBearerToken(request: Request): boolean {
  const header = request.headers.get('authorization');
  // Require a non-empty token after the scheme so `Bearer ` alone doesn't count.
  return header != null && /^Bearer\s+\S/i.test(header);
}

/**
 * Belt-and-suspenders CSRF defense. Clerk's session cookie already has
 * SameSite=Lax which blocks cross-origin POSTs in all modern browsers, but we
 * add an explicit Origin/Referer same-origin check on every mutation to close
 * the narrow window of browsers that get it wrong (older Safari quirks, some
 * WebView embeds). Webhook routes are exempt because they're signed payloads
 * from Clerk/Vercel with no session.
 *
 * Bearer-token requests are ALSO exempt, and that is safe by construction: CSRF
 * is exclusively a cookie-auth problem. A browser never auto-attaches an
 * `Authorization` header to a cross-site request — adding one forces a CORS
 * preflight we never grant — so a malicious page cannot forge a
 * bearer-authenticated request. The token is still authenticated downstream
 * (Clerk `auth.protect()` for app routes, or a route's own shared-secret check
 * for cron/admin jobs), so skipping the same-origin check here does NOT skip
 * authentication. This is what lets the native iOS app perform mutations.
 */
export function assertSameOrigin(request: Request): NextResponse | null {
  if (!MUTATION_METHODS.has(request.method)) return null;

  const url = new URL(request.url);
  // Skip webhooks — verified by their own signature header (Clerk HMAC, etc.).
  if (url.pathname.startsWith('/api/webhooks')) return null;

  // Skip non-cookie (bearer-authenticated) requests — not CSRF-vulnerable.
  if (hasBearerToken(request)) return null;

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const expected = url.origin;

  // If we have an Origin header, it must match. Browsers send Origin on every
  // POST/PUT/PATCH/DELETE in modern engines.
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

  // Neither header present — reject to be safe. Same-origin browser fetches
  // always send Origin; lack of both (without a bearer token) is either a
  // malformed request or a server-side call that wouldn't hit middleware anyway.
  return NextResponse.json({ error: 'CSRF: no origin' }, { status: 403 });
}
