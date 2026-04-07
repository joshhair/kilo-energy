import { test, expect } from '@playwright/test';

/**
 * Mobile viewport tests for Kilo Energy app.
 *
 * These tests run under the "mobile" project (iPhone 14 Pro viewport)
 * defined in playwright.config.ts.
 *
 * NOTE: Most dashboard pages are behind Clerk auth, so unauthenticated
 * requests will redirect to /sign-in. These tests verify that:
 *   1. The redirect works correctly on mobile viewports
 *   2. The sign-in page renders properly at mobile dimensions
 *   3. No layout issues (horizontal overflow, undersized targets) exist
 *
 * To add authenticated mobile tests, configure Clerk test mode:
 * https://clerk.com/docs/testing/playwright
 */

// ---------------------------------------------------------------------------
// All mobile screens load without 5xx errors
// ---------------------------------------------------------------------------

const mobileScreens = [
  '/dashboard',
  '/dashboard/projects',
  '/dashboard/new-deal',
  '/dashboard/my-pay',
  '/dashboard/payroll',
  '/dashboard/users',
  '/dashboard/blitz',
  '/dashboard/settings',
  '/dashboard/calculator',
  '/dashboard/incentives',
  '/dashboard/training',
  '/dashboard/earnings',
];

test.describe('Mobile screens load without errors', () => {
  for (const path of mobileScreens) {
    test(`${path} loads without server error`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(500);
      await page.waitForLoadState('domcontentloaded');
    });
  }
});

// ---------------------------------------------------------------------------
// Mobile component rendering
// ---------------------------------------------------------------------------

test.describe('Mobile component rendering', () => {
  test('sign-in page renders at mobile width', async ({ page }) => {
    await page.goto('/sign-in');
    await page.waitForLoadState('domcontentloaded');

    // Page should render without horizontal overflow at mobile width
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('dashboard redirects to sign-in on mobile viewport', async ({ page }) => {
    // Unauthenticated — should redirect to sign-in even on mobile
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('sign-in');
  });

  // NOTE: The following test requires Clerk test-mode authentication.
  // Once auth is configured, uncomment and adjust selectors to match
  // the actual mobile layout components.
  //
  // test('dashboard renders mobile component on phone viewport', async ({ page }) => {
  //   // After authenticating via Clerk test mode:
  //   await page.goto('/dashboard');
  //   // Mobile dashboard should NOT have the desktop sidebar visible
  //   const sidebar = page.locator('[data-testid="desktop-sidebar"]');
  //   await expect(sidebar).not.toBeVisible();
  //   // Should have bottom nav visible
  //   const bottomNav = page.locator('[data-testid="mobile-bottom-nav"]');
  //   await expect(bottomNav).toBeVisible();
  // });
});

// ---------------------------------------------------------------------------
// Touch target compliance
// ---------------------------------------------------------------------------

test.describe('Touch target compliance', () => {
  test.skip('sign-in interactive elements meet 40px minimum height', async ({ page }) => {
    // Skipped: Clerk's sign-in widget renders its own elements which we don't control
    await page.goto('/sign-in');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const buttons = await page.locator('button, a, [role="button"], input[type="submit"]').all();
    for (const btn of buttons) {
      const visible = await btn.isVisible();
      if (!visible) continue;

      const box = await btn.boundingBox();
      if (box) {
        expect(
          box.height,
          `Touch target too small (${box.height}px): ${await btn.textContent()}`
        ).toBeGreaterThanOrEqual(40);
      }
    }
  });

  // NOTE: Authenticated version — uncomment when Clerk test mode is set up
  // test('dashboard interactive elements meet 40px minimum height', async ({ page }) => {
  //   await page.goto('/dashboard');
  //   await page.waitForLoadState('networkidle');
  //   const buttons = await page.locator('button, a, [role="button"]').all();
  //   for (const btn of buttons) {
  //     const visible = await btn.isVisible();
  //     if (!visible) continue;
  //     const box = await btn.boundingBox();
  //     if (box) {
  //       expect(box.height).toBeGreaterThanOrEqual(40);
  //     }
  //   }
  // });
});

// ---------------------------------------------------------------------------
// No horizontal overflow
// ---------------------------------------------------------------------------

test.describe('No horizontal overflow', () => {
  test('sign-in page has no horizontal scroll', async ({ page }) => {
    await page.goto('/sign-in');
    await page.waitForLoadState('domcontentloaded');

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // 1px tolerance
  });

  test('homepage has no horizontal scroll', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  // NOTE: Authenticated version — uncomment when Clerk test mode is set up
  // test('dashboard has no horizontal scroll', async ({ page }) => {
  //   await page.goto('/dashboard');
  //   await page.waitForLoadState('networkidle');
  //   const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  //   const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  //   expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  // });
});

// ---------------------------------------------------------------------------
// Screenshot tests for visual regression
// ---------------------------------------------------------------------------

test.describe('Visual regression screenshots', () => {
  test.skip('sign-in mobile screenshot', async ({ page }) => {
    // Skipped: screenshot baselines need to be generated first with --update-snapshots
    await page.goto('/sign-in');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('sign-in-mobile.png', { maxDiffPixels: 100 });
  });

  test.skip('homepage mobile screenshot', async ({ page }) => {
    // Skipped: screenshot baselines need to be generated first with --update-snapshots
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('homepage-mobile.png', { maxDiffPixels: 100 });
  });

  // NOTE: Authenticated version — uncomment when Clerk test mode is set up
  // test('dashboard mobile screenshot', async ({ page }) => {
  //   await page.goto('/dashboard');
  //   await page.waitForLoadState('networkidle');
  //   await expect(page).toHaveScreenshot('dashboard-mobile.png', { maxDiffPixels: 100 });
  // });
});
