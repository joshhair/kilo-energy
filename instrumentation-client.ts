// Client-side Sentry initialization. Next 15+ + @sentry/nextjs v8+ convention:
// a file named instrumentation-client.ts at the project root is auto-loaded
// on every client entry. (Older Sentry docs reference sentry.client.config.ts
// — that path is deprecated and only works when withSentryConfig wraps
// next.config.ts. Using the instrumentation-client approach is lighter and
// matches the Next 15 instrumentation-hook pattern.)

import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,

    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,        // No session replay for now — privacy + cost.
    replaysOnErrorSampleRate: 0.1,      // Sample 10% of sessions that error for context.

    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,              // Treat all text as PII until proven otherwise.
        blockAllMedia: true,
      }),
    ],

    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
    ],
  });
}

// Next.js 15 expects this optional export to capture navigation spans.
// Harmless no-op when Sentry isn't initialized (DSN absent).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
