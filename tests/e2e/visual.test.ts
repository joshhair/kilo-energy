/**
 * Visual regression baselines for the highest-traffic dashboard surfaces.
 *
 * What this catches: layout drift that is invisible to unit + API + e2e tests.
 * Things like "Rebekah said the columns don't align with data" or "Josh said
 * the commission breakdown looks messy on iPhone" — those are layout bugs
 * that ship green because no logic test asserts pixel positions.
 *
 * Cadence: a GitHub Actions workflow (.github/workflows/visual-regression.yml)
 * runs this suite nightly against the live Vercel production deploy
 * (https://kilo-energy.vercel.app). On any diff exceeding the tolerance, the
 * workflow fails and Josh gets a notification with the diff PNGs attached
 * as artifacts.
 *
 * Intentional UI changes: regenerate baselines via
 *   `npm run test:visual:update`
 * locally, then commit the updated PNGs alongside the UI change. The CI
 * workflow refuses to update baselines on its own — every baseline change
 * needs human review.
 *
 * Fixture stability: tests pin Date.now() via Playwright's clock API and
 * apply a CSS stylesheet (visual-fixtures/hide-volatile.css) that masks
 * volatile content like sparklines, count-ups, and relative-time labels.
 * The remaining differences across runs should be ~0 pixels at the chosen
 * tolerance.
 *
 * Why list pages only (no detail pages): list routes don't depend on a
 * specific entity ID. Detail pages would need a stable fixture project /
 * user, which means a CI-controlled seeded DB — that's a follow-up. List
 * surfaces give us coverage of the dashboard chrome, navigation, table
 * layouts, and stat-card patterns that 80% of layout regressions live in.
 */

import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Frozen wall-clock for any code that reads Date.now() to render — keeps
// "3 days ago" strings, age counters, and date headers stable run-to-run.
const FROZEN_TIME = new Date('2026-05-13T12:00:00.000Z');

// CSS injected before each snapshot. Hides elements whose content is
// data-dependent (sparkline curves, $ amounts, names) and disables all
// CSS animations so a snapshot taken mid-transition isn't different
// from one taken at rest.
const HIDE_VOLATILE_CSS = fs.readFileSync(
  path.join(__dirname, 'visual-fixtures', 'hide-volatile.css'),
  'utf-8',
);

test.use({ storageState: 'tests/e2e/.auth/admin.json' });

// Per-spec page setup — applied before every test in this file. Keeps the
// frozen-time + hide-volatile pattern in one place instead of repeating
// it in every test body.
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: FROZEN_TIME });
});

async function stableScreenshot(page: Page, name: string) {
  // Inject volatility-hiding CSS *after* navigation so dynamic class names
  // resolved by React on mount are present when the rules apply. waitForLoadState
  // 'networkidle' is a stronger signal than 'domcontentloaded' for screenshots.
  await page.addStyleTag({ content: HIDE_VOLATILE_CSS });
  // Give one extra paint cycle for the CSS to settle.
  await page.waitForTimeout(250);
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    // Generous pixel tolerance — subpixel font rendering on Linux CI
    // vs macOS local can drift 0.3-0.5% without any layout change.
    // 1% = ~20k pixels on a 1920×1080 viewport, which is large enough
    // to absorb noise but small enough to catch any meaningful diff.
    maxDiffPixelRatio: 0.01,
    // Each animation step + clock-tick interaction can change layout
    // for a frame — retry a few times to land on a stable frame.
    animations: 'disabled',
  });
}

test.describe('Visual regression — desktop admin', () => {
  test('admin dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await stableScreenshot(page, 'admin-dashboard.png');
  });

  test('projects list', async ({ page }) => {
    await page.goto('/dashboard/projects');
    await page.waitForLoadState('networkidle');
    await stableScreenshot(page, 'projects-list.png');
  });

  test('users list', async ({ page }) => {
    await page.goto('/dashboard/users');
    await page.waitForLoadState('networkidle');
    await stableScreenshot(page, 'users-list.png');
  });

  test('payroll', async ({ page }) => {
    await page.goto('/dashboard/payroll');
    await page.waitForLoadState('networkidle');
    await stableScreenshot(page, 'payroll-list.png');
  });
});
