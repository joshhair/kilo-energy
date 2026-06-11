/**
 * Per-role authenticated mobile smoke (T4.4).
 *
 * The visual suite exercises the ADMIN session deeply; rep/sub-dealer/PM
 * sessions had no broad coverage, so a role-scoped rendering regression
 * (a hook crash in a role-gated branch, a 500 from a role-scoped fetch,
 * a bounce to /sign-in) could ship unnoticed. This suite signs in as each
 * seeded role and loads every route on that role's nav at the mobile
 * viewport (the field reps' reality), asserting:
 *   - the URL sticks (no bounce to / or /sign-in — F7 regression net),
 *   - the dashboard chrome renders (#main-content),
 *   - the React error boundary did not trip.
 *
 * Runs under the `role-smoke` project (chromium, 393x852, per-role
 * storageState via test.use inside each describe).
 */
import { test, expect } from '@playwright/test';

const ROLE_ROUTES: Record<string, { auth: string; routes: string[] }> = {
  rep: {
    auth: 'tests/e2e/.auth/rep.json',
    routes: ['/dashboard', '/dashboard/new-deal', '/dashboard/projects', '/dashboard/my-pay', '/dashboard/blitz', '/dashboard/calculator'],
  },
  'sub-dealer': {
    auth: 'tests/e2e/.auth/subdealer.json',
    routes: ['/dashboard', '/dashboard/new-deal', '/dashboard/projects', '/dashboard/my-pay'],
  },
  pm: {
    auth: 'tests/e2e/.auth/pm.json',
    routes: ['/dashboard', '/dashboard/projects', '/dashboard/users'],
  },
};

for (const [role, cfg] of Object.entries(ROLE_ROUTES)) {
  test.describe(`role smoke — ${role}`, () => {
    test.use({ storageState: cfg.auth });

    for (const route of cfg.routes) {
      test(`${role} loads ${route}`, async ({ page }) => {
        // Dev-only cold-start tolerance: the first hit on a not-yet-compiled
        // route can trip Clerk's dev-browser handshake into a transient
        // redirect loop (ERR_TOO_MANY_REDIRECTS). One retry after a beat —
        // prod/CI serve prebuilt routes and don't exhibit this.
        try {
          await page.goto(route);
        } catch (err) {
          if (err instanceof Error && err.message.includes('ERR_TOO_MANY_REDIRECTS')) {
            await page.waitForTimeout(1500);
            await page.goto(route);
          } else {
            throw err;
          }
        }
        // Let the in-place role bootstrap resolve + the page settle.
        await page.waitForSelector('#main-content', { timeout: 20_000 });
        await page.waitForLoadState('networkidle');
        expect(new URL(page.url()).pathname, 'route must stick (no auth bounce)').toBe(route);
        await expect(page.locator('#main-content')).toBeVisible();
        // ErrorBoundary fallback text must not be present anywhere.
        await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
      });
    }
  });
}
