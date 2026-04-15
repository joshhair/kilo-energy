// Next.js instrumentation hook — runs once per runtime (node/edge) before
// app code. Used to wire Sentry for server-side error tracking.
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return; // no-op when unset

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export async function onRequestError(err: unknown, request: { path?: string; method?: string; headers?: Record<string, string> }) {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(err, request as Parameters<typeof Sentry.captureRequestError>[1], { routerKind: 'App Router', routePath: request.path ?? '', routeType: 'route' });
}
