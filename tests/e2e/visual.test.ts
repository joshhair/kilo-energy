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
  // Suppress the PWA "Add to home screen" prompt — it overlays the bottom
  // nav on mobile and is volatile run-to-run. InstallPrompt checks this
  // localStorage flag on mount. addInitScript applies before every nav.
  await page.addInitScript(() => {
    try { localStorage.setItem('kilo-install-dismissed', '1'); } catch { /* noop */ }
  });
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

  // Desktop sidebar View-As dropdown. The selector sits in the sidebar's
  // non-scrolling footer; it now opens UPWARD as a height-capped overlay so
  // the candidate list can't overflow below the viewport (downward in-flow
  // pushed the list + footer off the bottom on shorter desktop heights).
  // Desktop-only: the mobile sidebar stays off-screen (never opened), so the
  // "View As..." button isn't reachable there — mobile uses the You page.
  test('admin sidebar — View As dropdown opens on-screen', async ({ page, isMobile }) => {
    test.skip(isMobile, 'sidebar selector is desktop-only; mobile uses the You page');
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    const trigger = page.getByRole('button', { name: 'View As...' });
    await trigger.waitFor({ state: 'visible' });
    await trigger.click();
    await page.getByPlaceholder('Search users...').waitFor({ state: 'visible' });
    await page.addStyleTag({ content: HIDE_VOLATILE_CSS });
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('admin-sidebar-view-as.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
});

// Mobile-only safety surfaces (Tier 1). These run under the `visual-mobile`
// project (393×852, iPhone UA, admin storage state). They are skipped on
// desktop because the routes are mobile-only (/dashboard/you redirects to
// /dashboard above 767px).
// T1.2 — deep links must NOT bounce to /dashboard. On a fresh load,
// dashboard/layout.tsx bounces through `/` while the role resolves (currentRole
// is briefly null), stashing the intended path in sessionStorage; app/page.tsx
// must return the user to that stashed path, not a hardcoded /dashboard.
// Runs under both authed projects (visual-desktop + visual-mobile), so it
// guards the viewport-agnostic fix on both. Not a visual test — URL only.
test.describe('Deep-link redirect (T1.2)', () => {
  for (const route of [
    '/dashboard/projects',
    '/dashboard/payroll',
    '/dashboard/users',
    '/dashboard/new-deal',
    '/dashboard/my-pay',
    '/dashboard/you', // mobile-only; redirects to /dashboard on desktop by design
  ]) {
    test(`preserves deep link ${route}`, async ({ page, isMobile }) => {
      test.skip(route === '/dashboard/you' && !isMobile, '/dashboard/you is mobile-only');
      await page.goto(route);
      // Allow the bounce-through-/ + role-resolve + return cycle to settle.
      await page.waitForURL((url) => url.pathname === route, { timeout: 15_000 }).catch(() => {});
      expect(new URL(page.url()).pathname).toBe(route);
    });
  }
});

// T1.8 — Runtime ancestor-walk guard. After the page-enter animation settles,
// EVERY visible position:fixed element must resolve to the viewport — i.e. none
// of its ancestors may create a CSS containing block (computed transform!=none,
// filter!=none, perspective!=none, backdrop-filter!=none, will-change naming
// transform/filter/perspective, or contain: layout/paint/strict/content). This
// catches the symptom regardless of cause: a new wrapper animation, a stray
// will-change, a `contain` added for perf — anything that would silently push a
// fixed CTA/pill/FAB/toolbar/modal footer-style instead of pinning it.
//
// Rides both authed projects (visual-desktop 1440×900 + visual-mobile 393×852)
// so the archetypes are covered on each viewport. Pure structural assertion —
// no screenshot/baseline, so no baseline churn.
type FixedOffender = { fixed: string; ancestor: string; reasons: string[] };

async function findFixedContainingBlockOffenders(page: Page): Promise<FixedOffender[]> {
  // Let the page-enter / section-enter animation finish so we read the SETTLED
  // computed styles (the fix ends those keyframes at transform:none).
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const describe = (el: Element): string => {
      const e = el as HTMLElement;
      const id = e.id ? `#${e.id}` : '';
      const cls = typeof e.className === 'string' && e.className
        ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
      const txt = (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
      return `${e.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ''}`;
    };
    // Reasons an ancestor would establish a containing block for fixed descendants.
    const cbReasons = (cs: CSSStyleDeclaration): string[] => {
      const r: string[] = [];
      if (cs.transform && cs.transform !== 'none') r.push(`transform:${cs.transform}`);
      if (cs.filter && cs.filter !== 'none') r.push(`filter:${cs.filter}`);
      if (cs.perspective && cs.perspective !== 'none') r.push(`perspective:${cs.perspective}`);
      const bf = (cs as unknown as { backdropFilter?: string }).backdropFilter;
      if (bf && bf !== 'none') r.push(`backdrop-filter:${bf}`);
      if (/transform|filter|perspective/.test(cs.willChange || '')) r.push(`will-change:${cs.willChange}`);
      if (/\b(layout|paint|strict|content)\b/.test(cs.contain || '')) r.push(`contain:${cs.contain}`);
      return r;
    };
    const isVisible = (el: Element): boolean => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const out: FixedOffender[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      if (getComputedStyle(el).position !== 'fixed' || !isVisible(el)) continue;
      let anc = el.parentElement;
      while (anc && anc !== document.documentElement && anc !== document.body) {
        const reasons = cbReasons(getComputedStyle(anc));
        if (reasons.length) out.push({ fixed: describe(el), ancestor: describe(anc), reasons });
        anc = anc.parentElement;
      }
    }
    return out;
  });
}

test.describe('Fixed-positioning containing-block guard (T1.8)', () => {
  // ID-free routes only (the desktop/mobile list + entry surfaces). Project
  // Detail is reached by clicking the first card so its fixed bottom bar is
  // covered without a seeded fixture ID.
  const ROUTES = [
    '/dashboard',
    '/dashboard/projects',
    '/dashboard/payroll',
    '/dashboard/new-deal',
    '/dashboard/users',
    '/dashboard/settings',
    '/dashboard/my-pay',
    '/dashboard/training',
    '/dashboard/blitz',
    '/dashboard/incentives',
  ];
  for (const route of ROUTES) {
    test(`no fixed element trapped in a containing block on ${route}`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const offenders = await findFixedContainingBlockOffenders(page);
      expect(
        offenders,
        `position:fixed elements trapped in a containing block:\n${JSON.stringify(offenders, null, 2)}`,
      ).toEqual([]);
    });
  }

  test('no fixed element trapped on mobile Project Detail (bottom bar)', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile Project Detail bottom bar is the mobile-only surface');
    await page.goto('/dashboard/projects');
    await page.waitForLoadState('networkidle');
    // Open the first project card to render MobileProjectDetail + its fixed bar.
    // Mobile rows are MobileCard <button>s (router.push), NOT <a href> links, so
    // target the card button (it carries the list's `animate-card-enter` class)
    // and ASSERT we actually reached a detail URL — otherwise the guard would
    // silently run on the list page and never exercise the fixed bottom bar.
    const firstCard = page.locator('button.animate-card-enter').first();
    await firstCard.waitFor({ state: 'visible', timeout: 10_000 });
    await firstCard.click();
    await page.waitForURL('**/dashboard/projects/*', { timeout: 10_000 });
    await page.waitForLoadState('networkidle');
    const offenders = await findFixedContainingBlockOffenders(page);
    expect(
      offenders,
      `position:fixed elements trapped in a containing block:\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });
});

test.describe('Visual regression — mobile safety surfaces', () => {
  // T1.8 — New Deal fixed bottom CTA must be VIEWPORT-pinned (portaled out of
  // the transformed step wrapper), not anchored to the wrapper. Asserts it's a
  // direct child of <body> and its bottom edge sits at the intended offset
  // (~72px above the viewport bottom), then snapshots step 0.
  test('mobile New Deal — CTA is viewport-pinned (portaled)', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile-only surface');
    await page.goto('/dashboard/new-deal');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /^Next/ }).waitFor({ state: 'visible' });
    const box = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /^Next/.test(b.textContent || ''));
      const bar = btn?.closest('div');
      const r = bar?.getBoundingClientRect();
      return { vh: window.innerHeight, barBottom: r ? Math.round(r.bottom) : null, portaledToBody: bar?.parentElement === document.body };
    });
    expect(box.portaledToBody).toBe(true);
    // bottom edge ≈ viewport bottom − 72px offset (allow safe-area slack).
    expect(box.vh - (box.barBottom ?? 0)).toBeGreaterThan(40);
    expect(box.vh - (box.barBottom ?? 0)).toBeLessThan(120);
    await page.addStyleTag({ content: HIDE_VOLATILE_CSS });
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('newdeal-step0.png', { fullPage: false, maxDiffPixelRatio: 0.01, animations: 'disabled' });
  });

  // T1.1 — the mobile View-As drawer must stay fully on-screen when opened.
  // It lives in the "You" page (MobileYou), opens an inline candidate panel,
  // and previously could render below the fold / behind the fixed bottom nav.
  // We use a VIEWPORT screenshot (fullPage: false) on purpose: the entire
  // point is to prove the drawer + candidate list sit within what the user
  // can actually see, not somewhere down a tall scrolled page.
  // T1.3 — the admin Payroll "Approve All" / "Publish Payroll" CTA must sit
  // ABOVE the bottom nav (was fixed bottom-0 z-40, hidden behind the z-50 nav),
  // and the feedback bubble must clear it. Viewport screenshot of the bottom.
  test('mobile Payroll — admin CTA + feedback clear the bottom nav', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile-only surface');
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'Payroll', exact: true }).click();
    await page.waitForURL('**/dashboard/payroll');
    await page.waitForLoadState('networkidle');
    // Pending tab → the "Publish Payroll" CTA renders. Then scroll to the
    // bottom so the last list row + the fixed CTA + nav are all in frame.
    await page.getByRole('tab', { name: 'Pending', exact: true }).click();
    await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById('main-content')?.scrollTo(0, 99999));
    await page.waitForTimeout(300);
    await page.addStyleTag({ content: HIDE_VOLATILE_CSS });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('mobile-payroll-cta.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  // T1.4 — Payroll utility actions (Add Payment / CSV / ADP / Print) live in a
  // single header "Actions" sheet, out of the browse path. Open it and snapshot.
  test('mobile Payroll — Actions sheet', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile-only surface');
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'Payroll', exact: true }).click();
    await page.waitForURL('**/dashboard/payroll');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Payroll actions' }).click();
    await page.getByText('Export CSV', { exact: true }).waitFor({ state: 'visible' });
    await page.addStyleTag({ content: HIDE_VOLATILE_CSS });
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('mobile-payroll-actions.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('mobile You — View As drawer open stays on-screen', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile-only surface (/dashboard/you redirects on desktop)');
    // Reach the You page the way a mobile user does — tap the bottom-nav tab.
    // (Direct deep-linking to /dashboard/you bounces to /dashboard on a
    // hydration-timing race — that's the separate T1.2 bug; client-side nav
    // via the tab is the real user path and doesn't bounce.)
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.locator('a[href="/dashboard/you"]').click();
    await page.waitForURL('**/dashboard/you');

    const trigger = page.getByRole('button', { name: /view as user/i });
    await trigger.waitFor({ state: 'visible' });
    await trigger.click();
    await page.getByPlaceholder('Search users...').waitFor({ state: 'visible' });

    await page.addStyleTag({ content: HIDE_VOLATILE_CSS });
    // Let the open animation + scrollIntoView settle onto a stable frame.
    await page.waitForTimeout(400);

    await expect(page).toHaveScreenshot('mobile-view-as-drawer.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
});
