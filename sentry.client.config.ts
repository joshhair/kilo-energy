import * as Sentry from '@sentry/nextjs';

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
