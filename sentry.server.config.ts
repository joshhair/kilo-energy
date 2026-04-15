import * as Sentry from '@sentry/nextjs';

// PII fields we never want in Sentry events — mirrors lib/logger.ts blacklist.
const PII_KEYS = new Set(['email', 'phone', 'token', 'ssn', 'dob', 'password', 'authorization']);

function scrub(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(scrub);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = PII_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : scrub(v);
  }
  return out;
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,

  // 10% of transactions in prod, 100% in preview for richer debugging.
  tracesSampleRate: process.env.VERCEL_ENV === 'production' ? 0.1 : 1.0,

  // Strip PII before send. Defense in depth — logger already scrubs, this is belt-and-suspenders.
  beforeSend(event) {
    if (event.request?.data) event.request.data = scrub(event.request.data);
    if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>;
    // Drop user.email — we identify by Clerk userId only.
    if (event.user?.email) delete event.user.email;
    return event;
  },

  ignoreErrors: [
    // Clerk sign-in race on first load — benign.
    'ClerkAPIError',
    // Next.js 404s aren't errors for our purposes.
    'NEXT_NOT_FOUND',
  ],
});
