// Regression test for T0.6 (hardening master plan): public PWA install assets
// must be reachable WITHOUT auth. `/manifest.json` was being auth-gated in prod
// because `.json` is deliberately excluded from the static-asset matcher bypass
// (API routes return JSON), so the manifest request reached middleware and hit
// auth.protect(). The browser fetches the manifest while still on the sign-in
// page, so a redirect there breaks PWA install.
//
// We keep the REAL createRouteMatcher (so isPublicRoute matching is exercised
// for real) and stub only clerkMiddleware to hand us a fake `auth` whose
// protect() is a spy, plus stub the rate limiter to a no-op.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const protectSpy = vi.fn();

vi.mock('@clerk/nextjs/server', async (importActual) => {
  const actual = await importActual<typeof import('@clerk/nextjs/server')>();
  return {
    ...actual,
    // Pass the handler straight through, injecting a fake auth object.
    clerkMiddleware: (handler: (auth: unknown, req: NextRequest) => unknown) =>
      (req: NextRequest) => handler({ protect: protectSpy }, req),
  };
});

vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(null),
}));

import middleware from '@/middleware';

// The default export is a Clerk middleware typed as (request, event); our stub
// ignores the event, so call it through a single-arg view for the tests.
const run = (path: string) =>
  (middleware as unknown as (req: NextRequest) => Promise<unknown>)(
    new NextRequest(`http://localhost${path}`, { method: 'GET' }),
  );

describe('middleware — public route allowlist', () => {
  beforeEach(() => protectSpy.mockClear());

  it('does NOT gate /manifest.json (PWA manifest)', async () => {
    await run('/manifest.json');
    expect(protectSpy).not.toHaveBeenCalled();
  });

  it('does NOT gate /icons/* (PWA icons)', async () => {
    await run('/icons/icon-192.png');
    expect(protectSpy).not.toHaveBeenCalled();
  });

  it('does NOT gate the sign-in page', async () => {
    await run('/sign-in');
    expect(protectSpy).not.toHaveBeenCalled();
  });

  it('DOES gate a protected app page (/dashboard)', async () => {
    await run('/dashboard');
    expect(protectSpy).toHaveBeenCalled();
  });
});
