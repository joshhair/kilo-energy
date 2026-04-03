import { test, expect } from '@playwright/test';

/**
 * Smoke tests — verify the app boots and critical pages/APIs respond.
 *
 * These tests hit the running Next.js dev server. Pages behind Clerk auth
 * will redirect to /sign-in, which is the expected behavior.
 *
 * To add authenticated E2E tests, configure Clerk test mode:
 * https://clerk.com/docs/testing/playwright
 */

test.describe('App boot & health', () => {
  test('homepage loads', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
  });

  test('sign-in page loads', async ({ page }) => {
    await page.goto('/sign-in');
    const response = await page.waitForLoadState('domcontentloaded');
    // Clerk sign-in widget should render
    expect(await page.title()).toBeTruthy();
  });

  test('sign-up page loads', async ({ page }) => {
    await page.goto('/sign-up');
    await page.waitForLoadState('domcontentloaded');
    expect(await page.title()).toBeTruthy();
  });
});

test.describe('Auth redirects', () => {
  test('dashboard redirects to sign-in when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    // Should redirect to sign-in
    expect(page.url()).toContain('sign-in');
  });

  test('new-deal redirects to sign-in when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard/new-deal');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('sign-in');
  });

  test('payroll redirects to sign-in when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard/payroll');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('sign-in');
  });

  test('projects redirects to sign-in when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard/projects');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('sign-in');
  });
});

test.describe('API health', () => {
  test('protected API returns 401 without auth', async ({ request }) => {
    const response = await request.get('/api/data');
    // Should return 401 or redirect (Clerk middleware)
    expect([401, 403, 307, 302]).toContain(response.status());
  });

  test('webhooks endpoint is public', async ({ request }) => {
    const response = await request.post('/api/webhooks', {
      data: { test: true },
    });
    // Webhooks route is public — should not return 401
    // May return 400/405/500 depending on handler, but NOT 401/403
    expect(response.status()).not.toBe(401);
  });
});
