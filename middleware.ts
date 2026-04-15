import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
]);

// State-changing HTTP methods. GET/HEAD/OPTIONS can't mutate, so they
// don't need the Origin/Referer CSRF check.
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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

export default clerkMiddleware(async (auth, request) => {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

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
