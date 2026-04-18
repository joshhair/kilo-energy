// Accessibility guardrail — runs axe-core against the app's most-visited
// surfaces and fails the build on serious/critical violations. Targets the
// bug classes that slipped through this quarter:
//   - color-contrast (white-on-emerald gradient buttons)
//   - button-name / link-name (icon-only controls without aria-label)
//   - label (inputs lacking associated labels)
//
// Severity filter: we only fail on 'serious' and 'critical'. 'moderate' and
// 'minor' show up in the report for info but don't block merges — avoids
// churn over things like landmark regions that rarely matter to real users.

import { test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Result } from 'axe-core';

const BLOCKING_IMPACTS = ['serious', 'critical'] as const;

function formatViolations(violations: Result[]) {
  return violations
    .map((v) => {
      const targets = v.nodes
        .slice(0, 3)
        .map((n) => `    ${JSON.stringify(n.target)}`)
        .join('\n');
      const extra = v.nodes.length > 3 ? `\n    … and ${v.nodes.length - 3} more` : '';
      return `[${v.impact ?? 'n/a'}] ${v.id} — ${v.help}\n${targets}${extra}`;
    })
    .join('\n\n');
}

async function scan(page: import('@playwright/test').Page, routeLabel: string) {
  const results = await new AxeBuilder({ page })
    // Tag-filter: wcag2a + wcag2aa cover the rules that actually matter for
    // user impact. 'best-practice' adds noise we don't need.
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact && BLOCKING_IMPACTS.includes(v.impact as typeof BLOCKING_IMPACTS[number]),
  );

  if (blocking.length > 0) {
    // Fail the test with a human-readable report instead of a giant JSON dump.
    throw new Error(
      `a11y violations on ${routeLabel}:\n\n${formatViolations(blocking)}`,
    );
  }
  // Log non-blocking violations for awareness; does not fail the run.
  if (results.violations.length > 0) {
    console.log(
      `[a11y] ${routeLabel}: ${results.violations.length} non-blocking violation(s) — ${results.violations.map((v) => v.id).join(', ')}`,
    );
  }
}

test.describe('a11y — anonymous surfaces', () => {
  test('sign-in page has no serious/critical violations', async ({ page }) => {
    await page.goto('/sign-in');
    await page.waitForLoadState('domcontentloaded');
    // Clerk loads async; give it a beat to render its form.
    await page.waitForTimeout(800);
    await scan(page, '/sign-in');
  });
});

test.describe('a11y — authenticated admin surfaces', () => {
  // Use the same admin storage state the other golden-path tests use.
  test.use({ storageState: 'tests/e2e/.auth/admin.json' });

  test('dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await scan(page, '/dashboard');
  });

  test('projects list', async ({ page }) => {
    await page.goto('/dashboard/projects');
    await page.waitForLoadState('networkidle');
    await scan(page, '/dashboard/projects');
  });

  test('users list', async ({ page }) => {
    await page.goto('/dashboard/users');
    await page.waitForLoadState('networkidle');
    await scan(page, '/dashboard/users');
  });

  test('incentives', async ({ page }) => {
    await page.goto('/dashboard/incentives');
    await page.waitForLoadState('networkidle');
    await scan(page, '/dashboard/incentives');
  });

  test('training (Trainer Hub)', async ({ page }) => {
    await page.goto('/dashboard/training');
    await page.waitForLoadState('networkidle');
    await scan(page, '/dashboard/training');
  });

  test('payroll', async ({ page }) => {
    await page.goto('/dashboard/payroll');
    await page.waitForLoadState('networkidle');
    await scan(page, '/dashboard/payroll');
  });

  test('blitz list', async ({ page }) => {
    await page.goto('/dashboard/blitz');
    await page.waitForLoadState('networkidle');
    await scan(page, '/dashboard/blitz');
  });

  test('settings (installer/financer/pricing)', async ({ page }) => {
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');
    await scan(page, '/dashboard/settings');
  });

  test('commission calculator', async ({ page }) => {
    await page.goto('/dashboard/calculator');
    await page.waitForLoadState('networkidle');
    await scan(page, '/dashboard/calculator');
  });

  test('new-deal form', async ({ page }) => {
    await page.goto('/dashboard/new-deal');
    await page.waitForLoadState('networkidle');
    await scan(page, '/dashboard/new-deal');
  });
});

test.describe('a11y — authenticated rep surfaces', () => {
  test.use({ storageState: 'tests/e2e/.auth/rep.json' });

  test('dashboard (rep view)', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await scan(page, '/dashboard (rep)');
  });

  test('earnings', async ({ page }) => {
    await page.goto('/dashboard/earnings');
    await page.waitForLoadState('networkidle');
    await scan(page, '/dashboard/earnings');
  });

  test('new-deal form (rep)', async ({ page }) => {
    await page.goto('/dashboard/new-deal');
    await page.waitForLoadState('networkidle');
    await scan(page, '/dashboard/new-deal (rep)');
  });
});
